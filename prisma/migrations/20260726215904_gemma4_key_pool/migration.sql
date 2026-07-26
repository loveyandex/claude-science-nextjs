-- CreateTable
CREATE TABLE "CerebrasApiKey" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CerebrasApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "gemma4ConcurrencyMode" TEXT NOT NULL DEFAULT 'pages_per_pdf',

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

