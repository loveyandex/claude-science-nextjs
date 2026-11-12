# Set the frontend port environment variable
$env:PORT=3200

# Run the backend as a background job inside this same session
Start-Job -Name "BackendServer" -ScriptBlock {
    cd backend
    python -m venv venv
    .\venv\Scripts\Activate.ps1
    uvicorn main:app --host 0.0.0.0 --port 8000
}

# Run the frontend directly in the foreground
npm run build
npm start
