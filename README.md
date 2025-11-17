# Clarity - AI-Powered Time Awareness Assistant

Clarity is a mobile application built with React Native Expo and Django that helps users with time blindness manage their time effectively using AI-powered insights.

## Features

- 🤖 **AI Time Estimation**: Get realistic time estimates for tasks based on your past performance
- 📊 **Feedback Loop**: The AI learns from how you actually perform vs estimates
- 📅 **Google Calendar Integration**: Sync your calendar events
- ✅ **Task Management**: Simple, intelligent to-do list
- 💬 **AI Chat**: Talk to your personalized Clarity assistant
- 📱 **Cross-Platform**: Works on iOS, Android, and Web

## Technology Stack

- **Frontend**: React Native Expo (TypeScript)
- **Backend**: Django + Django REST Framework
- **Database**: SQLite (for MVP)
- **AI**: Claude API (Anthropic)
- **Authentication**: Token-based auth with Django

## Prerequisites

- Python 3.9+
- Node.js 16+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)

## Setup Instructions

### 1. Backend Setup (Django)

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Mac/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file (copy from .env.example and fill in your keys)
cp .env.example .env

# Run migrations
python manage.py makemigrations
python manage.py migrate

# Create superuser (optional, for admin access)
python manage.py createsuperuser

# Run development server
python manage.py runserver 0.0.0.0:8000