import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import urllib.request, json

app = FastAPI()

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    try:
        url = "https://api.hku.hk/openai/student/deployments/gpt-4.1-nano/chat/completions?api-version=2025-04-01-preview"

        hdr = {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'api-key': '228a0e171e5c47829e71e93e4d695fc0', # I am doing what a responsible developer should not do, putting my api key here :D
        }

        data = {
            "messages": [
                {
                    "role": "system",
                    "content": "You are a helpful assistant."
                },
                {
                    "role": "user",
                    "content": request.message
                }
            ],
            "max_tokens": 100,
        }
        
        req_data = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, headers=hdr, data=req_data, method='POST')
        
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            reply_text = res_json["choices"][0]["message"]["content"]
            token_usage = res_json["usage"]["total_tokens"]
            print(f"Token usage: {token_usage} tokens")
            
            return {"response": reply_text}

    except Exception as e:
        print("Error:", str(e))
        raise HTTPException(status_code=502, detail=f"Unable to reach the chat service: {str(e)}")

# Mount static files AFTER API routes so /api/chat isn't intercepted
app.mount("/", StaticFiles(directory="./Frontend", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)