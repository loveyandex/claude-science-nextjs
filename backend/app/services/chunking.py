"""Deterministic, resumable text chunking.

A PDF page's markdown is far bigger than the ~512-token window of the
embedding model, so each page becomes several chunks. Two properties
matter more than cleverness here:

1. **Determinism.** chunk(text, policy) must always yield the same list.
   The database stores only a chunk *count* and a resume *index*; if the
   boundaries moved between runs, resuming would embed the wrong slice
   and leave orphaned vectors behind.
2. **Respecting structure.** Splitting mid-sentence produces chunks that
   retrieve badly. So text is broken into paragraphs, then sentences,
   then (only if a single sentence is still too long) words — never
   blindly every N characters.
"""

from __future__ import annotations

import math
import re

from app.domain.models import Chunk, ChunkingPolicy

_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
# Sentence-ish: end punctuation followed by whitespace. Kept intentionally
# simple — an over-eager split just makes a slightly smaller chunk, while a
# heavyweight NLP dependency would make this service much heavier to run.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?;:])\s+")
_WORD_SPLIT = re.compile(r"\s+")


class HeuristicTokenEstimator:
    """Token count estimate with no tokenizer dependency.

    Takes the *larger* of two well-known rules of thumb (≈4 characters per
    token, ≈1.33 tokens per whitespace word). Over-estimating is the safe
    direction: it yields slightly smaller chunks, and staying under the
    embedding model's hard token limit matters more than packing chunks
    to exactly the requested size.
    """

    CHARS_PER_TOKEN = 4.0
    TOKENS_PER_WORD = 1.33

    def count(self, text: str) -> int:
        stripped = text.strip()
        if not stripped:
            return 0
        by_chars = len(stripped) / self.CHARS_PER_TOKEN
        by_words = len([w for w in _WORD_SPLIT.split(stripped) if w]) * self.TOKENS_PER_WORD
        return max(1, math.ceil(max(by_chars, by_words)))


class StructuralTextChunker:
    """`TextChunker` that packs structural atoms up to a token budget."""

    def __init__(self, policy: ChunkingPolicy, estimator: "HeuristicTokenEstimator | None" = None):
        self._policy = policy.normalized()
        self._estimator = estimator or HeuristicTokenEstimator()

    @property
    def policy(self) -> ChunkingPolicy:
        return self._policy

    def chunk(self, text: str) -> list[Chunk]:
        atoms = self._atomize(text)
        if not atoms:
            return []

        budget = self._policy.max_tokens
        groups: list[list[str]] = []
        current: list[str] = []

        for atom in atoms:
            # Measure the *joined* candidate rather than summing per-atom
            # estimates: the joiner adds separator characters and each
            # per-atom `ceil` rounds up independently, so a sum can differ
            # from the text actually stored — by enough to sit a chunk one
            # token over the limit.
            if current and self._group_tokens(current + [atom]) > budget:
                groups.append(current)
                # The carried-over overlap has to leave room for the atom
                # that triggered the split, or the new chunk is born over
                # budget — which the embedding model resolves by silently
                # truncating, i.e. by dropping text we think we indexed.
                current = self._overlap_tail(current, budget - self._estimator.count(atom))
                while current and self._group_tokens(current + [atom]) > budget:
                    current.pop(0)
            current.append(atom)

        if current:
            groups.append(current)

        groups = self._merge_trailing_sliver(groups)

        chunks: list[Chunk] = []
        for index, group in enumerate(groups):
            body = "\n".join(group).strip()
            if not body:
                continue
            chunks.append(Chunk(index=len(chunks), text=body, token_estimate=self._estimator.count(body)))
        return chunks

    # --- internals --------------------------------------------------------

    def _group_tokens(self, group: list[str]) -> int:
        """Token estimate of the text this group would actually become."""
        return self._estimator.count("\n".join(group))

    def _atomize(self, text: str) -> list[str]:
        """Break text into the smallest units we're willing to keep whole."""
        atoms: list[str] = []
        for paragraph in _PARAGRAPH_SPLIT.split(text or ""):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            if self._estimator.count(paragraph) <= self._policy.max_tokens:
                atoms.append(paragraph)
                continue
            for sentence in _SENTENCE_SPLIT.split(paragraph):
                sentence = sentence.strip()
                if not sentence:
                    continue
                if self._estimator.count(sentence) <= self._policy.max_tokens:
                    atoms.append(sentence)
                else:
                    atoms.extend(self._split_long_sentence(sentence))
        return atoms

    def _split_long_sentence(self, sentence: str) -> list[str]:
        """Last resort for something with no sentence breaks at all —
        a wide table row, a long equation, an unbroken reference list."""
        pieces: list[str] = []
        current: list[str] = []
        for word in (w for w in _WORD_SPLIT.split(sentence) if w):
            for part in self._split_long_word(word):
                candidate = " ".join(current + [part])
                if current and self._estimator.count(candidate) > self._policy.max_tokens:
                    pieces.append(" ".join(current))
                    current = [part]
                else:
                    current.append(part)
        if current:
            pieces.append(" ".join(current))
        return pieces

    def _split_long_word(self, word: str) -> list[str]:
        """A single "word" can still blow the budget on its own — a
        base64 blob, a mangled table row with no spaces, a long DOI list
        run together by the transcription. Nothing structural is left to
        split on at this point, so slice by characters."""
        if self._estimator.count(word) <= self._policy.max_tokens:
            return [word]
        span = max(1, int(self._policy.max_tokens * HeuristicTokenEstimator.CHARS_PER_TOKEN))
        return [word[i : i + span] for i in range(0, len(word), span)]

    def _overlap_tail(self, group: list[str], headroom: int) -> list[str]:
        """The trailing atoms of a finished chunk that also open the next
        one, so a thought split across a boundary stays retrievable.

        `headroom` is how many tokens the next chunk can spend on overlap
        and still fit the atom that's about to be appended.
        """
        allowance = min(self._policy.overlap_tokens, headroom)
        if allowance <= 0:
            return []
        tail: list[str] = []
        tokens = 0
        for atom in reversed(group):
            atom_tokens = self._estimator.count(atom)
            if tokens + atom_tokens > allowance:
                break
            tail.insert(0, atom)
            tokens += atom_tokens
        # Never let overlap alone fill the whole chunk — that would stall
        # forward progress on pathological input.
        if len(tail) >= len(group):
            return tail[1:]
        return tail

    def _merge_trailing_sliver(self, groups: list[list[str]]) -> list[list[str]]:
        """Fold a too-small final chunk back into its predecessor — but
        only if the result still fits the budget. Overshooting here would
        hand the embedding model more tokens than it accepts, and it
        truncates silently rather than complaining."""
        if len(groups) < 2:
            return groups
        last_tokens = sum(self._estimator.count(a) for a in groups[-1])
        if last_tokens >= self._policy.min_tokens:
            return groups

        previous = groups[-2]
        # The sliver's atoms may already be present in the previous group
        # as overlap; only carry over the ones that aren't, so merging
        # can't duplicate text.
        tail = [a for a in groups[-1] if a not in previous]
        if not tail:
            return groups[:-1]
        if self._group_tokens(previous + tail) > self._policy.max_tokens:
            return groups
        merged = groups[:-1]
        merged[-1] = previous + tail
        return merged


def build_chunker(policy: ChunkingPolicy) -> StructuralTextChunker:
    """Factory used by the service layer so it never names a concrete
    chunker class — swapping in a tokenizer-backed implementation later
    is a one-line change here."""
    return StructuralTextChunker(policy)
