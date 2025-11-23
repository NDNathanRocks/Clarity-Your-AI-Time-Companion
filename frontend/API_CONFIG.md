# API Configuration Guide

## How to Update the API IP Address

When your laptop's IP address changes (which happens when you switch WiFi networks), you only need to update **ONE FILE**.

### Quick Update Instructions

1. **Find your laptop's current IP address:**
   - **Windows**: Open Command Prompt and run `ipconfig` (look for IPv4 Address)
   - **Mac/Linux**: Open Terminal and run `ifconfig` or `ip addr`

2. **Update the `.env` file:**
   - Open `frontend/.env`
   - Change the IP address in `EXPO_PUBLIC_API_URL_MOBILE` to your new IP
   - Example: `EXPO_PUBLIC_API_URL_MOBILE=http://192.168.1.100:8000/api`

3. **Restart your app:**
   - Stop and restart your Expo development server
   - Reload the app on your phone

### Files Changed

The following files now use the centralized config:
- `frontend/app/index.tsx` - Main app
- `frontend/app/components/AddTaskModal.tsx` - Add task modal
- `frontend/app/components/EditTaskModal.tsx` - Edit task modal
- `frontend/app/config.ts` - Central configuration (reads from .env)

### Environment Variables

All API URLs are now stored in `frontend/.env`:
- `EXPO_PUBLIC_API_URL_WEB` - For web browser (localhost)
- `EXPO_PUBLIC_API_URL_MOBILE` - For iPhone/Android (your laptop's IP)

### Important Notes

- The `.env` file should **NOT** be committed to git (it's in `.gitignore`)
- Each developer needs their own `.env` file with their laptop's IP
- The app will log the current API URL in the console on startup for debugging
