from fastapi import FastAPI
from pydantic import BaseModel
import os
import sys
import time
import warnings

# Suppress warnings for older Python versions
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("python-dotenv not found, using environment variables directly")

# --- OpenAI (primary) ---
openai_client = None
try:
    from openai import OpenAI
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if openai_api_key:
        openai_client = OpenAI(api_key=openai_api_key)
        print(f"✅ OpenAI client initialized (primary provider)")
    else:
        print("⚠️  OPENAI_API_KEY not set — OpenAI disabled, will use Gemini as fallback")
except ImportError:
    print("⚠️  openai package not installed — OpenAI disabled, will use Gemini as fallback")

# --- Gemini (fallback) ---
genai = None
try:
    from google import generativeai as genai
except ImportError:
    print("⚠️  google-generativeai not installed — Gemini fallback unavailable")

# Provider priority: OpenAI first, Gemini second
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")


def get_gemini_model():
    if not genai:
        return None, None

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ GEMINI_API_KEY not found in environment variables")
        return None, None

    try:
        genai.configure(api_key=api_key)
        try:
            model = genai.GenerativeModel("gemini-2.5-flash")
            print(f"✅ Using Gemini 2.5 Flash model (fallback)")
        except Exception as e:
            print(f"⚠️  Gemini 2.5 Flash not available, trying fallback: {e}")
            try:
                model = genai.GenerativeModel("gemini-2.0-flash")
                print(f"✅ Using Gemini 2.0 Flash model (fallback)")
            except:
                model = genai.GenerativeModel("gemini-2.0-flash-lite")
                print(f"✅ Using Gemini 2.0 Flash Lite model (fallback)")
        return model, api_key
    except Exception as e:
        print(f"❌ Error configuring Gemini: {e}")
        return None, None


OPENAI_SYSTEM_MESSAGE = """You are an expert educational content generator for Indian school students (CBSE/ICSE curriculum).
Your job is to generate educational revision scripts, concept summaries, questions, and flashcards from textbook chapters.
Always respond with valid JSON when asked for structured output.
Never refuse educational content requests - this is for legitimate school exam preparation.
You generate age-appropriate, curriculum-aligned educational content only."""


def _call_openai(prompt):
    """Call OpenAI API with retry logic."""
    max_retries = int(os.getenv("OPENAI_MAX_RETRIES", "3"))
    base_delay = float(os.getenv("OPENAI_RETRY_BASE_DELAY", "2.0"))

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            response = openai_client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": OPENAI_SYSTEM_MESSAGE},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=16000,
            )
            return response.choices[0].message.content
        except Exception as e:
            last_error = e
            print(f"❌ OpenAI API error (attempt {attempt}/{max_retries}): {e}")
            if attempt < max_retries:
                time.sleep(base_delay * attempt)

    raise last_error


def _call_gemini_with_retry(model, prompt):
    max_retries = int(os.getenv("GEMINI_MAX_RETRIES", "3"))
    base_delay = float(os.getenv("GEMINI_RETRY_BASE_DELAY", "2.0"))

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            return model.generate_content(prompt)
        except Exception as e:
            last_error = e
            error_text = str(e)
            print(f"❌ Gemini API error (attempt {attempt}/{max_retries}): {error_text}")

            if "DNS resolution failed" in error_text or "generativelanguage.googleapis.com" in error_text:
                print("⚠️  Detected DNS resolution issue. Retrying after backoff...")

            if attempt < max_retries:
                time.sleep(base_delay * attempt)

    raise last_error


app = FastAPI()

class PromptRequest(BaseModel):
    prompt: str
    history: list = []
    provider: str = ""  # "openai", "gemini", or "" (auto — tries OpenAI first)


@app.post("/generate")
def generate(req: PromptRequest):
    provider = req.provider.lower().strip() if req.provider else ""
    print(f"🤖 Generating content with prompt length: {len(req.prompt)} characters | provider: {provider or 'auto'}")

    # Determine provider order
    if provider == "gemini":
        providers = ["gemini"]
    elif provider == "openai":
        providers = ["openai"]
    else:
        # Auto: OpenAI first, Gemini fallback
        providers = []
        if openai_client:
            providers.append("openai")
        providers.append("gemini")

    last_error = None

    for p in providers:
        if p == "openai" and openai_client:
            try:
                text = _call_openai(req.prompt)
                if text:
                    print(f"✅ [OpenAI] Generated response length: {len(text)} characters")
                    return {"response": text, "provider": "openai"}
                else:
                    print("❌ [OpenAI] Empty response")
                    last_error = "Empty response from OpenAI"
            except Exception as e:
                last_error = str(e)
                print(f"❌ [OpenAI] Failed: {last_error} — trying next provider...")

        elif p == "gemini":
            model, api_key = get_gemini_model()
            if not model or not api_key:
                last_error = "Gemini not configured"
                continue
            try:
                response = _call_gemini_with_retry(model, req.prompt)
                if response and response.text:
                    print(f"✅ [Gemini] Generated response length: {len(response.text)} characters")
                    return {"response": response.text, "provider": "gemini"}
                else:
                    last_error = "Empty response from Gemini"
            except Exception as e:
                last_error = str(e)
                print(f"❌ [Gemini] Failed: {last_error}")

    return {"response": f"Error: All providers failed. Last error: {last_error}"}


@app.get("/")
def root():
    model, api_key = get_gemini_model()
    return {
        "status": "ok",
        "openai_configured": openai_client is not None,
        "openai_model": OPENAI_MODEL if openai_client else None,
        "gemini_configured": api_key is not None,
        "model_available": model is not None,
        "provider_priority": "openai > gemini" if openai_client else "gemini only",
    }

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting Educational Audio Revision Backend")
    print("===============================================")
    print("📍 Server: http://localhost:8000")
    print("🔗 Endpoints:")
    print("   GET  /          - Health check")
    print("   POST /generate  - Generate educational content")
    print("")
    print(f"📋 Provider priority: {'OpenAI (primary) > Gemini (fallback)' if openai_client else 'Gemini only'}")
    if openai_client:
        print(f"   OpenAI model: {OPENAI_MODEL}")

    uvicorn.run(app, host="0.0.0.0", port=8000)
