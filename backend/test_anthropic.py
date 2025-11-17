"""
Quick test script to verify Anthropic API key and connection
Run this to debug the chat endpoint issue
"""
import os
import anthropic
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

api_key = os.getenv('ANTHROPIC_API_KEY', '')

print(f"API Key present: {bool(api_key)}")
print(f"API Key length: {len(api_key) if api_key else 0}")
print(f"API Key starts with: {api_key[:10] if api_key else 'N/A'}...")

if not api_key:
    print("\n❌ ERROR: ANTHROPIC_API_KEY not found in environment!")
    print("Make sure you have a .env file with ANTHROPIC_API_KEY=sk-ant-...")
    exit(1)

print("\n🔄 Testing Anthropic API connection...")

try:
    client = anthropic.Anthropic(api_key=api_key)
    
    message = client.messages.create(
        model="claude-3-haiku-20240307",
        max_tokens=100,
        messages=[
            {"role": "user", "content": "Hello! Just testing the connection. Reply with 'OK' if you receive this."}
        ]
    )
    
    response_text = message.content[0].text
    
    print(f"\n✅ SUCCESS! API connection works.")
    print(f"Response: {response_text}")
    
except anthropic.APIConnectionError as e:
    print(f"\n❌ API Connection Error: {e}")
    print("This usually means network issues or firewall blocking the API.")
    
except anthropic.AuthenticationError as e:
    print(f"\n❌ Authentication Error: {e}")
    print("Your API key is invalid or expired.")
    
except anthropic.RateLimitError as e:
    print(f"\n❌ Rate Limit Error: {e}")
    print("You've hit the API rate limit.")
    
except Exception as e:
    print(f"\n❌ Unexpected Error: {type(e).__name__}: {e}")
    import traceback
    print("\nFull traceback:")
    print(traceback.format_exc())
