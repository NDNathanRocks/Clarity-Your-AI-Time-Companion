import json
import anthropic
import pytz
from datetime import datetime, timedelta
from django.conf import settings
from django.contrib.auth import authenticate
from django.utils import timezone
from django.db import models
from rest_framework import status, generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.authtoken.models import Token
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from django.shortcuts import redirect
from django.contrib.auth.models import User

from .models import UserProfile, Task, TaskFeedback, CalendarEvent, AIMemory
from .serializers import (
    RegisterSerializer, UserSerializer, UserProfileSerializer,
    TaskSerializer, TaskFeedbackSerializer, CalendarEventSerializer, AIMemorySerializer
)


# ============================================================================
# AUTHENTICATION VIEWS
# ============================================================================

@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    """Register a new user"""
    print(f"[REGISTER] Request received from {request.META.get('REMOTE_ADDR')}")
    print(f"[REGISTER] Data: username={request.data.get('username')}, email={request.data.get('email')}")
    
    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        token, created = Token.objects.get_or_create(user=user)
        print(f"[REGISTER] Success - User {user.username} registered")
        return Response({
            'token': token.key,
            'user': UserSerializer(user).data,
            'message': 'User registered successfully'
        }, status=status.HTTP_201_CREATED)
    
    print(f"[REGISTER] Validation failed: {serializer.errors}")
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """Login user and return token"""
    print(f"[LOGIN] Request received from {request.META.get('REMOTE_ADDR')}")
    
    username = request.data.get('username')
    password = request.data.get('password')
    
    print(f"[LOGIN] Attempting login for username: {username}")
    
    if not username or not password:
        print("[LOGIN] Missing username or password")
        return Response(
            {'error': 'Please provide both username and password'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    user = authenticate(username=username, password=password)
    
    if user:
        token, created = Token.objects.get_or_create(user=user)
        print(f"[LOGIN] Success - User {user.username} logged in")
        return Response({
            'token': token.key,
            'user': UserSerializer(user).data,
            'message': 'Login successful'
        }, status=status.HTTP_200_OK)
    
    print(f"[LOGIN] Authentication failed for username: {username}")
    return Response(
        {'error': 'Invalid credentials'},
        status=status.HTTP_401_UNAUTHORIZED
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """Logout user by deleting their token"""
    try:
        request.user.auth_token.delete()
        return Response({'message': 'Logout successful'}, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def profile_view(request):
    """Get user profile with AI insights"""
    # Ensure a profile exists for the user (defensive in case of older users)
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    
    # Get AI memory for insights
    ai_memory, _ = AIMemory.objects.get_or_create(user=request.user)
    
    # Generate or retrieve AI summary
    ai_summary = None
    # Generate summary if user has ANY data (tasks, onboarding, or memory)
    user_has_data = (
        Task.objects.filter(user=request.user).exists() or
        ai_memory.onboarding_completed or
        ai_memory.task_categories or
        ai_memory.performance_metrics
    )
    
    print(f"[PROFILE] User {request.user.username} - Has data: {user_has_data}")
    print(f"[PROFILE] Tasks: {Task.objects.filter(user=request.user).count()}")
    print(f"[PROFILE] Onboarding: {ai_memory.onboarding_completed}")
    print(f"[PROFILE] Categories: {bool(ai_memory.task_categories)}")
    print(f"[PROFILE] Metrics: {bool(ai_memory.performance_metrics)}")
    
    if user_has_data:
        # Always regenerate on login for fresh, motivational message
        should_regenerate = True
        
        print(f"[PROFILE] Regenerating AI summary on login")
        print(f"[PROFILE] Current summary: {ai_memory.ai_summary[:50] if ai_memory.ai_summary else 'None'}")
        
        if should_regenerate:
            try:
                print(f"[PROFILE] Generating new AI summary for {request.user.username}")
                ai_summary = generate_ai_summary(request.user, ai_memory)
                print(f"[PROFILE] Generated: {ai_summary}")
                ai_memory.ai_summary = ai_summary
                ai_memory.ai_summary_updated = timezone.now()
                ai_memory.save()
                print(f"[PROFILE] Saved AI summary to database")
            except Exception as e:
                print(f"[PROFILE] Error generating AI summary: {str(e)}")
                import traceback
                print(traceback.format_exc())
                ai_summary = ai_memory.ai_summary if ai_memory.ai_summary else None
        else:
            # Use cached summary
            print(f"[PROFILE] Using cached AI summary for {request.user.username}")
            ai_summary = ai_memory.ai_summary
    else:
        print(f"[PROFILE] No data yet for user {request.user.username}")
    
    response_data = UserProfileSerializer(profile).data
    response_data['ai_summary'] = ai_summary
    response_data['ai_memory'] = AIMemorySerializer(ai_memory).data
    
    return Response(response_data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def profile_update(request):
    """Update user profile (username, first_name, last_name)"""
    user = request.user
    
    username = request.data.get('username')
    first_name = request.data.get('first_name', '')
    last_name = request.data.get('last_name', '')
    
    try:
        # Check if username is being changed and if it's already taken
        if username and username != user.username:
            if User.objects.filter(username=username).exists():
                return Response({
                    'error': 'This username is already taken. Please choose another.'
                }, status=status.HTTP_400_BAD_REQUEST)
            user.username = username
        
        # Update name fields
        user.first_name = first_name
        user.last_name = last_name
        user.save()
        
        # Return updated user data
        return Response({
            'user': UserSerializer(user).data,
            'message': 'Profile updated successfully!'
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        return Response({
            'error': f'Failed to update profile: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ============================================================================
# GOOGLE CALENDAR VIEWS
# ============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def google_calendar_connect(request):
    """Initiate Google OAuth flow"""
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
            }
        },
        scopes=['https://www.googleapis.com/auth/calendar.readonly'],
        redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI
    )
    
    # Store user ID in state for callback
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        state=str(request.user.id)
    )
    
    return Response({'authorization_url': authorization_url})


@api_view(['GET'])
@permission_classes([AllowAny])
def google_calendar_redirect(request):
    """Handle Google OAuth callback"""
    code = request.GET.get('code')
    state = request.GET.get('state')
    
    if not code:
        return Response({'error': 'No authorization code provided'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Get user from state
        user_id = int(state)
        user = User.objects.get(id=user_id)
        
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                    "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
                }
            },
            scopes=['https://www.googleapis.com/auth/calendar.readonly'],
            redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI
        )
        
        flow.fetch_token(code=code)
        credentials = flow.credentials
        
        # Save tokens to user profile
        profile = user.profile
        profile.google_access_token = credentials.token
        profile.google_refresh_token = credentials.refresh_token
        profile.google_token_expiry = credentials.expiry
        profile.save()
        
        # Redirect to a success page or deep link
        return Response({
            'message': 'Google Calendar connected successfully!',
            'success': True
        })
    
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def google_calendar_events(request):
    """Fetch calendar events for the next 7 days (both Google and app-based)"""
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    all_events = []
    
    # Get app-based calendar events (from start of today, next 30 days)
    now = timezone.now()
    # Start from beginning of today to capture events created today
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_date = now + timedelta(days=30)
    
    # Also check from yesterday to account for timezone differences
    start_query = start_of_today - timedelta(days=1)
    
    app_events = CalendarEvent.objects.filter(
        user=request.user,
        start_time__gte=start_query,
        start_time__lte=end_date
    ).order_by('start_time')
    
    print(f"[CALENDAR] Found {app_events.count()} app events for user {request.user.username}")
    print(f"[CALENDAR] Query range: {start_query} to {end_date}")
    print(f"[CALENDAR] Now: {now}")
    print(f"[CALENDAR] Total events in DB for user: {CalendarEvent.objects.filter(user=request.user).count()}")
    for evt in app_events:
        print(f"[CALENDAR] Event: {evt.id} - {evt.title} at {evt.start_time}")
    
    for event in app_events:
        # Check if this event is linked to a task to get priority and status
        task_priority = None
        task_status = None
        task_id = None
        event_id_str = f'app-{event.id}'
        try:
            linked_task = Task.objects.filter(user=request.user, calendar_event_id=event_id_str).first()
            if linked_task:
                task_priority = linked_task.priority
                task_status = linked_task.status
                task_id = linked_task.id
        except:
            pass
        
        all_events.append({
            'id': f'app-{event.id}',
            'title': event.title,
            'start': event.start_time.isoformat(),
            'end': event.end_time.isoformat(),
            'description': event.description,
            'location': event.location,
            'source': 'app',
            'color': event.color,
            'all_day': event.all_day,
            'priority': task_priority,  # Will be None for non-task events
            'status': task_status,  # Will be None for non-task events
            'task_id': task_id,  # Will be None for non-task events
        })
    
    # Try to get Google Calendar events if connected
    has_google = bool(profile.google_access_token)
    
    if has_google:
        try:
            credentials = Credentials(
                token=profile.google_access_token,
                refresh_token=profile.google_refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
                client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET
            )
            
            service = build('calendar', 'v3', credentials=credentials)
            
            # Get events for next 7 days
            time_min = datetime.utcnow().isoformat() + 'Z'
            time_max = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
            
            events_result = service.events().list(
                calendarId='primary',
                timeMin=time_min,
                timeMax=time_max,
                maxResults=50,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])
            
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                end = event['end'].get('dateTime', event['end'].get('date'))
                
                all_events.append({
                    'id': f'google-{event["id"]}',
                    'title': event.get('summary', 'No Title'),
                    'start': start,
                    'end': end,
                    'description': event.get('description', ''),
                    'location': event.get('location', ''),
                    'source': 'google_calendar',
                    'color': '#4285F4',  # Google blue
                })
        except Exception as e:
            print(f"[GOOGLE CALENDAR ERROR] {str(e)}")
            # Don't fail if Google Calendar fails, just continue with app events
    
    # Sort all events by start time
    all_events.sort(key=lambda x: x['start'])
    
    return Response({
        'events': all_events,
        'has_google_calendar': has_google,
        'connected': True
    })


# ============================================================================
# TASK VIEWS
# ============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def task_list(request):
    """Get all tasks for the current user (only parent tasks, subtasks included in serializer)"""
    # Only get tasks without a parent (top-level tasks)
    tasks = Task.objects.filter(user=request.user, parent_task__isnull=True)
    serializer = TaskSerializer(tasks, many=True)
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_estimate(request):
    """
    AI-powered task time estimation using learned patterns from AI Memory
    This is the CORE of the AI feedback loop with personalization
    """
    task_title = request.data.get('title', '')
    
    if not task_title:
        return Response({'error': 'Task title is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Get AI memory for learned patterns
    ai_memory, _ = AIMemory.objects.get_or_create(user=request.user)
    
    # Get user's past feedback for AI context
    past_feedback = TaskFeedback.objects.filter(user=request.user).order_by('-timestamp')[:10]
    
    # Build context for Claude
    context_items = []
    for feedback in past_feedback:
        feedback_text = {
            'on_time': 'completed on time',
            'little_late': 'took a bit longer than expected',
            'very_late': 'took much longer than expected',
            'early': 'finished early'
        }.get(feedback.user_feedback, 'completed')
        
        context_items.append(
            f"Task: '{feedback.task_title}' (estimated {feedback.estimated_duration} min) - {feedback_text}"
        )
    
    context_str = "\n".join(context_items) if context_items else "No previous task history yet."
    
    # Add learned patterns from AI memory
    learned_patterns = ""
    task_category = extract_task_category(task_title)
    
    if task_category and ai_memory.task_categories:
        cat_data = ai_memory.task_categories.get(task_category, {})
        if cat_data:
            learned_patterns = f"\n\nLearned pattern for {task_category}:\n"
            learned_patterns += f"- Average time: {cat_data.get('avg_time', 0):.0f} minutes\n"
            learned_patterns += f"- Completed {cat_data.get('count', 0)} times\n"
            learned_patterns += f"- Feedback: {json.dumps(cat_data.get('feedback_distribution', {}))}"
    
    # Add velocity factor
    velocity_context = ""
    if ai_memory.performance_metrics:
        velocity_factor = ai_memory.performance_metrics.get('velocity_factor', 1.0)
        if velocity_factor > 1.0:
            velocity_context = f"\n\nNote: User typically takes about {int((velocity_factor - 1) * 100)}% longer than estimated."
        elif velocity_factor < 1.0:
            velocity_context = f"\n\nNote: User typically finishes about {int((1 - velocity_factor) * 100)}% faster than estimated."
    
    # Call Claude API
    try:
        if not settings.ANTHROPIC_API_KEY:
            # Fallback for MVP testing without API key
            estimate_minutes = 60  # Default
            friendly_message = f"I'd estimate about {estimate_minutes} minutes for '{task_title}'. (Note: AI estimation is not configured)"
        else:
            client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
            
            # Clean strings to avoid UTF-8 encoding issues
            clean_title = task_title.encode('ascii', 'ignore').decode('ascii')
            clean_context = context_str[:200].encode('ascii', 'ignore').decode('ascii')
            clean_patterns = (learned_patterns[:150] if learned_patterns else '').encode('ascii', 'ignore').decode('ascii')
            clean_velocity = (velocity_context[:100] if velocity_context else '').encode('ascii', 'ignore').decode('ascii')
            
            prompt = f"""Estimate time for: "{clean_title}"

Past performance:
{clean_context}
{clean_patterns}
{clean_velocity}

Provide realistic estimate. Keep friendly_message BRIEF (max 40 chars). Use only ASCII characters.

JSON format:
{{"estimate_minutes": 90, "friendly_message": "~1.5hrs based on your pace"}}"""
            
            message = client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=1024,
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            
            # Parse Claude's response
            response_text = message.content[0].text
            
            # Try to extract JSON from response
            try:
                # Sometimes Claude wraps JSON in markdown
                if '```json' in response_text:
                    json_str = response_text.split('```json')[1].split('```')[0].strip()
                elif '```' in response_text:
                    json_str = response_text.split('```')[1].split('```')[0].strip()
                else:
                    json_str = response_text
                
                ai_response = json.loads(json_str)
                estimate_minutes = ai_response.get('estimate_minutes', 60)
                friendly_message = ai_response.get('friendly_message', f"I'd estimate about {estimate_minutes} minutes for this task!")
            except json.JSONDecodeError:
                # Fallback if JSON parsing fails
                estimate_minutes = 60
                friendly_message = response_text if len(response_text) < 300 else "I'd estimate about 60 minutes for this task!"
        
        # Just return estimate - don't create task yet
        # Frontend will call /tasks/create/ after user decides on breakdown
        return Response({
            'friendly_message': friendly_message,
            'estimate_minutes': estimate_minutes,
            'task_category': task_category
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        print(f"[ESTIMATE ERROR] {str(e)}")
        import traceback
        print(traceback.format_exc())
        return Response({
            'error': f'AI estimation failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_breakdown_analyze(request):
    """
    Analyze a task and suggest breakdown into subtasks if complex.
    This is "The Clarity Breakdown" - witty, encouraging, and smart.
    """
    task_title = request.data.get('title', '')
    task_description = request.data.get('description', '')
    
    if not task_title:
        return Response({'error': 'Task title is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Get user's AI memory for personalization
        ai_memory, _ = AIMemory.objects.get_or_create(user=request.user)
        
        # Get recent task feedback for context
        recent_feedback = TaskFeedback.objects.filter(user=request.user).order_by('-timestamp')[:10]
        
        # Build user context
        performance_context = ""
        if recent_feedback.exists():
            performance_summary = {}
            for fb in recent_feedback:
                performance_summary[fb.user_feedback] = performance_summary.get(fb.user_feedback, 0) + 1
            performance_context = f"User tends to: {', '.join([f'{k}: {v} times' for k, v in performance_summary.items()])}"
        
        # Get task categories from AI memory
        task_categories = ai_memory.task_categories or {}
        category_context = ""
        if task_categories:
            category_context = f"Known task patterns: {json.dumps(task_categories, indent=2)}"
        
        # Get user preferences from onboarding
        preferences_hint = ""
        if ai_memory.onboarding_data:
            prefs = ai_memory.onboarding_data
            hints = []
            if prefs.get('work_style') in ['sprint', 'short_frequent']:
                hints.append("User prefers shorter focused sessions (20-30 min)")
            elif prefs.get('work_style') in ['marathon', 'deep_dive']:
                hints.append("User prefers longer deep work sessions (90+ min)")
            else:
                hints.append("User prefers balanced work sessions (45-60 min)")
            
            if prefs.get('break_preference') == 'short_frequent':
                hints.append("Include breaks every hour")
            elif prefs.get('break_preference') == 'long_rare':
                hints.append("Can work longer without breaks")
            
            if hints:
                preferences_hint = f"User preferences: {'; '.join(hints)}"
        
        # Call Claude for task analysis
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        
        prompt = f"""Analyze if this task needs breakdown into subtasks.

Task: "{task_title}"
{f'Details: {task_description[:100]}' if task_description else ''}

User patterns: {performance_context[:100] if performance_context else 'Learning...'}
{preferences_hint}

Break down if: >90min, multi-step, or complex.
IMPORTANT: Size subtasks according to user's work style preferences above.

Respond with ONLY valid JSON. Keep all text BRIEF (under 40 chars):
{{
  "should_break_down": true/false,
  "reasoning": "Brief reason",
  "suggested_subtasks": [
    {{"title": "Short title", "estimated_minutes": 30, "description": "Brief desc"}},
  ],
  "total_estimated_minutes": 120,
  "witty_message": "Short encouraging msg"
}}

If no breakdown needed, return empty suggested_subtasks array."""

        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = message.content[0].text
        
        # Parse response
        try:
            if '```json' in response_text:
                json_str = response_text.split('```json')[1].split('```')[0].strip()
            elif '```' in response_text:
                json_str = response_text.split('```')[1].split('```')[0].strip()
            else:
                json_str = response_text
            
            breakdown_data = json.loads(json_str)
            
            return Response({
                'should_break_down': breakdown_data.get('should_break_down', False),
                'reasoning': breakdown_data.get('reasoning', ''),
                'suggested_subtasks': breakdown_data.get('suggested_subtasks', []),
                'total_estimated_minutes': breakdown_data.get('total_estimated_minutes', 60),
                'witty_message': breakdown_data.get('witty_message', '✨ The Clarity Breakdown is ready!')
            }, status=status.HTTP_200_OK)
        
        except json.JSONDecodeError as e:
            print(f"[BREAKDOWN] JSON parse error: {e}")
            print(f"[BREAKDOWN] Response: {response_text}")
            # Fallback - no breakdown
            return Response({
                'should_break_down': False,
                'reasoning': 'Unable to analyze task complexity',
                'suggested_subtasks': [],
                'total_estimated_minutes': 60,
                'witty_message': 'Let\'s tackle this task as-is!'
            }, status=status.HTTP_200_OK)
    
    except Exception as e:
        print(f"[BREAKDOWN] Error: {str(e)}")
        return Response({
            'error': f'Task breakdown analysis failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_create_with_subtasks(request):
    """
    Create a task with optional subtasks (from accepted Clarity Breakdown)
    Can also create a single subtask if parent_task is specified
    """
    task_title = request.data.get('title', '')
    task_description = request.data.get('description', '')
    estimated_minutes = request.data.get('estimated_duration_minutes', 60)
    ai_message = request.data.get('ai_message', '')
    subtasks_data = request.data.get('subtasks', [])
    priority = request.data.get('priority', 'medium')
    location = request.data.get('location')
    scheduled_date = request.data.get('scheduled_date')
    scheduled_time = request.data.get('scheduled_time')
    parent_task_id = request.data.get('parent_task')  # For creating subtasks
    order = request.data.get('order', 0)
    
    if not task_title:
        return Response({'error': 'Task title is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # If parent_task is specified, create as a subtask
        if parent_task_id:
            try:
                parent = Task.objects.get(id=parent_task_id, user=request.user)
                subtask = Task.objects.create(
                    user=request.user,
                    parent_task=parent,
                    title=task_title,
                    description=task_description,
                    estimated_duration_minutes=estimated_minutes,
                    ai_friendly_message=ai_message,
                    status='pending',
                    order=order,
                )
                return Response({
                    'task': TaskSerializer(subtask).data,
                    'message': 'Subtask created successfully!'
                }, status=status.HTTP_201_CREATED)
            except Task.DoesNotExist:
                return Response({'error': 'Parent task not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Otherwise, create parent task with optional subtasks
        parent_task = Task.objects.create(
            user=request.user,
            title=task_title,
            description=task_description,
            estimated_duration_minutes=estimated_minutes,
            ai_friendly_message=ai_message,
            status='pending',
            priority=priority,
            location=location,
            scheduled_date=scheduled_date if scheduled_date else None,
            scheduled_time=scheduled_time if scheduled_time else None,
        )
        
        # Create subtasks if provided
        subtasks = []
        for idx, subtask_data in enumerate(subtasks_data):
            subtask = Task.objects.create(
                user=request.user,
                parent_task=parent_task,
                title=subtask_data.get('title', ''),
                description=subtask_data.get('description', ''),
                estimated_duration_minutes=subtask_data.get('estimated_duration_minutes', 30),
                ai_friendly_message=subtask_data.get('ai_message', ''),
                status='pending',
                order=idx,  # Set order based on position in array
            )
            subtasks.append(subtask)
        
        return Response({
            'task': TaskSerializer(parent_task).data,
            'message': f'Created task with {len(subtasks)} subtasks!' if subtasks else 'Task created successfully!'
        }, status=status.HTTP_201_CREATED)
    
    except Exception as e:
        return Response({
            'error': f'Task creation failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_find_slots(request):
    """
    Find available time slots for a task on a specific date.
    Returns suggested time slots based on existing events and tasks.
    """
    print(f"[FIND SLOTS] Request data: {request.data}")
    task_id = request.data.get('task_id')
    target_date_str = request.data.get('date')  # YYYY-MM-DD format
    
    print(f"[FIND SLOTS] task_id: {task_id}, date: {target_date_str}")
    
    if not task_id or not target_date_str:
        print(f"[FIND SLOTS] Missing required fields - task_id: {task_id}, date: {target_date_str}")
        return Response({'error': 'task_id and date are required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        from datetime import datetime, time as dt_time, timedelta
        
        task = Task.objects.get(id=task_id, user=request.user)
        target_date = datetime.strptime(target_date_str, '%Y-%m-%d').date()
        
        # Get all events and scheduled tasks for that day (timezone-aware)
        naive_start = datetime.combine(target_date, dt_time(0, 0))
        naive_end = datetime.combine(target_date, dt_time(23, 59, 59))
        
        # Make timezone-aware using local timezone
        local_tz = pytz.timezone('America/Los_Angeles')  # PST/PDT
        start_of_day = local_tz.localize(naive_start)
        end_of_day = local_tz.localize(naive_end)
        
        # Get calendar events
        events = CalendarEvent.objects.filter(
            user=request.user,
            start_time__gte=start_of_day,
            start_time__lt=end_of_day
        ).order_by('start_time')
        
        # Get scheduled tasks
        scheduled_tasks = Task.objects.filter(
            user=request.user,
            scheduled_date=target_date
        ).exclude(id=task_id).order_by('scheduled_time')
        
        # Build busy periods
        busy_periods = []
        
        for event in events:
            busy_periods.append({
                'start': event.start_time.time(),
                'end': event.end_time.time(),
                'title': event.title,
                'type': 'event'
            })
        
        for st in scheduled_tasks:
            if st.scheduled_time:
                start_time = st.scheduled_time
                end_datetime = datetime.combine(target_date, start_time) + timedelta(minutes=st.estimated_duration_minutes)
                busy_periods.append({
                    'start': start_time,
                    'end': end_datetime.time(),
                    'title': st.title,
                    'type': 'task'
                })
        
        # Sort busy periods by start time
        busy_periods.sort(key=lambda x: x['start'])
        
        # Find available slots (9 AM - 9 PM working hours)
        work_start = dt_time(9, 0)
        work_end = dt_time(21, 0)
        task_duration_minutes = task.estimated_duration_minutes
        
        available_slots = []
        current_time = work_start
        
        for busy in busy_periods:
            busy_start = busy['start']
            
            # Check if there's a gap before this busy period
            if current_time < busy_start:
                # Calculate if task fits in this gap
                slot_start_dt = datetime.combine(target_date, current_time)
                busy_start_dt = datetime.combine(target_date, busy_start)
                gap_minutes = (busy_start_dt - slot_start_dt).total_seconds() / 60
                
                if gap_minutes >= task_duration_minutes:
                    available_slots.append({
                        'start_time': current_time.strftime('%H:%M'),
                        'end_time': (slot_start_dt + timedelta(minutes=task_duration_minutes)).time().strftime('%H:%M'),
                        'duration_minutes': task_duration_minutes
                    })
            
            # Move current_time to after this busy period
            current_time = busy['end']
        
        # Check if there's time after the last busy period
        if current_time < work_end:
            slot_start_dt = datetime.combine(target_date, current_time)
            work_end_dt = datetime.combine(target_date, work_end)
            gap_minutes = (work_end_dt - slot_start_dt).total_seconds() / 60
            
            if gap_minutes >= task_duration_minutes:
                available_slots.append({
                    'start_time': current_time.strftime('%H:%M'),
                    'end_time': (slot_start_dt + timedelta(minutes=task_duration_minutes)).time().strftime('%H:%M'),
                    'duration_minutes': task_duration_minutes
                })
        
        # If no slots found during work hours, suggest early morning or late evening
        if not available_slots:
            available_slots = [
                {'start_time': '07:00', 'end_time': (datetime.combine(target_date, dt_time(7, 0)) + timedelta(minutes=task_duration_minutes)).time().strftime('%H:%M'), 'duration_minutes': task_duration_minutes},
                {'start_time': '21:00', 'end_time': (datetime.combine(target_date, dt_time(21, 0)) + timedelta(minutes=task_duration_minutes)).time().strftime('%H:%M'), 'duration_minutes': task_duration_minutes}
            ]
        
        return Response({
            'task_id': task_id,
            'date': target_date_str,
            'task_duration': task_duration_minutes,
            'available_slots': available_slots[:5],  # Return top 5 slots
            'busy_periods': busy_periods
        }, status=status.HTTP_200_OK)
    
    except Task.DoesNotExist:
        return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f"[FIND SLOTS ERROR] {str(e)}")
        import traceback
        print(traceback.format_exc())
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_schedule(request):
    """
    Schedule a task at a specific date and time, creating a calendar event for it.
    """
    print(f"[TASK SCHEDULE] Request data: {request.data}")
    task_id = request.data.get('task_id')
    scheduled_date_str = request.data.get('date')  # YYYY-MM-DD
    scheduled_time_str = request.data.get('time')  # HH:MM
    
    print(f"[TASK SCHEDULE] task_id: {task_id}, date: {scheduled_date_str}, time: {scheduled_time_str}")
    
    if not all([task_id, scheduled_date_str, scheduled_time_str]):
        return Response({'error': 'task_id, date, and time are required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        from datetime import datetime, timedelta
        
        task = Task.objects.get(id=task_id, user=request.user)
        
        # Parse date and time
        scheduled_date = datetime.strptime(scheduled_date_str, '%Y-%m-%d').date()
        # Handle both HH:MM and HH:MM:SS formats
        try:
            scheduled_time = datetime.strptime(scheduled_time_str, '%H:%M:%S').time()
        except ValueError:
            scheduled_time = datetime.strptime(scheduled_time_str, '%H:%M').time()
        
        # Create start and end datetime (naive - in user's local timezone)
        # Django will store these as-is without UTC conversion
        naive_start = datetime.combine(scheduled_date, scheduled_time)
        naive_end = naive_start + timedelta(minutes=task.estimated_duration_minutes)
        
        # Make timezone-aware but interpret as local time, not UTC
        local_tz = pytz.timezone('America/Los_Angeles')  # PST/PDT
        start_datetime = local_tz.localize(naive_start)
        end_datetime = local_tz.localize(naive_end)
        
        # Create calendar event for this task
        calendar_event = CalendarEvent.objects.create(
            user=request.user,
            title=f"🎯 {task.title}",
            description=f"Task: {task.title}\nEstimated duration: {task.estimated_duration_minutes} min",
            start_time=start_datetime,
            end_time=end_datetime,
            all_day=False,
            color='#6366f1'
        )
        
        # Update task with schedule info
        task.scheduled_date = scheduled_date
        task.scheduled_time = scheduled_time
        task.calendar_event_id = f"app-{calendar_event.id}"
        task.save()
        
        print(f"[TASK SCHEDULE] Task {task.id} scheduled for {scheduled_date} at {scheduled_time}")
        print(f"[TASK SCHEDULE] Created calendar event {calendar_event.id}")
        print(f"[TASK SCHEDULE] Event times: {calendar_event.start_time} to {calendar_event.end_time}")
        print(f"[TASK SCHEDULE] Total calendar events for user: {CalendarEvent.objects.filter(user=request.user).count()}")
        
        return Response({
            'message': 'Task scheduled successfully!',
            'task': TaskSerializer(task).data,
            'calendar_event': CalendarEventSerializer(calendar_event).data
        }, status=status.HTTP_200_OK)
    
    except Task.DoesNotExist:
        return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f"[TASK SCHEDULE ERROR] {str(e)}")
        import traceback
        print(traceback.format_exc())
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_feedback_create(request):
    """
    Save user feedback on task completion
    This data feeds back into the AI estimation and updates AI memory
    """
    task_id = request.data.get('task_id')
    user_feedback = request.data.get('feedback')
    notes = request.data.get('notes', '')
    
    if not task_id or not user_feedback:
        return Response({
            'error': 'task_id and feedback are required'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        task = Task.objects.get(id=task_id)
        task.status = 'done'
        task.completed_at = timezone.now()
        task.save()
        
        # Store feedback (could be saved to a Feedback model if needed)
        # For now, just acknowledge receipt
        return Response({
            'success': True,
            'message': 'Feedback received and task marked complete'
        }, status=status.HTTP_200_OK)
    except Task.DoesNotExist:
        return Response({
            'error': 'Task not found'
        }, status=status.HTTP_404_NOT_FOUND)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_reschedule(request):
    """
    Reschedule an existing task to a new date/time
    """
    print(f"[TASK RESCHEDULE] Request data: {request.data}")
    task_id = request.data.get('task_id')
    new_date_str = request.data.get('date')
    new_time_str = request.data.get('time')
    
    if not all([task_id, new_date_str, new_time_str]):
        return Response({'error': 'task_id, date, and time are required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        from datetime import datetime, timedelta
        
        task = Task.objects.get(id=task_id, user=request.user)
        
        # Parse new date and time
        new_date = datetime.strptime(new_date_str, '%Y-%m-%d').date()
        # Handle both HH:MM and HH:MM:SS formats
        try:
            new_time = datetime.strptime(new_time_str, '%H:%M:%S').time()
        except ValueError:
            new_time = datetime.strptime(new_time_str, '%H:%M').time()
        
        # Create new start and end datetime (naive - in user's local timezone)
        naive_start = datetime.combine(new_date, new_time)
        naive_end = naive_start + timedelta(minutes=task.estimated_duration_minutes)
        
        # Make timezone-aware using local timezone
        local_tz = pytz.timezone('America/Los_Angeles')  # PST/PDT
        new_start_datetime = local_tz.localize(naive_start)
        new_end_datetime = local_tz.localize(naive_end)
        
        # Update existing calendar event if it exists
        if task.calendar_event_id:
            try:
                event_id = int(task.calendar_event_id.replace('app-', ''))
                calendar_event = CalendarEvent.objects.get(id=event_id, user=request.user)
                calendar_event.start_time = new_start_datetime
                calendar_event.end_time = new_end_datetime
                calendar_event.save()
                print(f"[TASK RESCHEDULE] Updated existing event {event_id}")
            except CalendarEvent.DoesNotExist:
                # Calendar event was deleted, create new one
                calendar_event = CalendarEvent.objects.create(
                    user=request.user,
                    title=f"🎯 {task.title}",
                    description=f"Task: {task.title}\nEstimated duration: {task.estimated_duration_minutes} min",
                    start_time=new_start_datetime,
                    end_time=new_end_datetime,
                    all_day=False,
                    color='#6366f1'
                )
                task.calendar_event_id = f"app-{calendar_event.id}"
                print(f"[TASK RESCHEDULE] Created new event {calendar_event.id}")
        else:
            # No calendar event exists, create one
            calendar_event = CalendarEvent.objects.create(
                user=request.user,
                title=f"🎯 {task.title}",
                description=f"Task: {task.title}\nEstimated duration: {task.estimated_duration_minutes} min",
                start_time=new_start_datetime,
                end_time=new_end_datetime,
                all_day=False,
                color='#6366f1'
            )
            task.calendar_event_id = f"app-{calendar_event.id}"
            print(f"[TASK RESCHEDULE] Created new event {calendar_event.id}")
        
        # Update task schedule info
        task.scheduled_date = new_date
        task.scheduled_time = new_time
        task.save()
        
        print(f"[TASK RESCHEDULE] Task {task.id} rescheduled to {new_date} at {new_time}")
        
        return Response({
            'message': 'Task rescheduled successfully!',
            'task': TaskSerializer(task).data,
            'calendar_event': CalendarEventSerializer(calendar_event).data
        }, status=status.HTTP_200_OK)
    
    except Task.DoesNotExist:
        return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f"[TASK RESCHEDULE ERROR] {str(e)}")
        import traceback
        print(traceback.format_exc())
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def task_unschedule(request):
    """
    Remove scheduling from a task and delete its calendar event
    """
    task_id = request.data.get('task_id')
    
    if not task_id:
        return Response({'error': 'task_id is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        task = Task.objects.get(id=task_id, user=request.user)
        
        # Delete calendar event if it exists
        if task.calendar_event_id:
            try:
                event_id = int(task.calendar_event_id.replace('app-', ''))
                CalendarEvent.objects.filter(id=event_id, user=request.user).delete()
                print(f"[TASK UNSCHEDULE] Deleted calendar event {event_id}")
            except Exception as e:
                print(f"[TASK UNSCHEDULE] Could not delete calendar event: {e}")
        
        # Clear schedule info from task
        task.scheduled_date = None
        task.scheduled_time = None
        task.calendar_event_id = None
        task.save()
        
        print(f"[TASK UNSCHEDULE] Task {task.id} unscheduled")
        
        return Response({
            'message': 'Task schedule cleared!',
            'task': TaskSerializer(task).data
        }, status=status.HTTP_200_OK)
    
    except Task.DoesNotExist:
        return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f"[TASK UNSCHEDULE ERROR] {str(e)}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    try:
        task = Task.objects.get(id=task_id, user=request.user)
        
        # Create feedback entry
        feedback = TaskFeedback.objects.create(
            user=request.user,
            task=task,
            task_title=task.title,
            estimated_duration=task.estimated_duration_minutes,
            user_feedback=user_feedback,
            notes=notes
        )
        
        # Update task status
        task.status = 'done'
        task.completed_at = timezone.now()
        task.save()
        
        # Update AI memory with this feedback
        ai_memory, _ = AIMemory.objects.get_or_create(user=request.user)
        
        # Extract task category (e.g., "Math151" from "Math151 Homework")
        task_category = extract_task_category(task.title)
        
        if task_category:
            categories = ai_memory.task_categories or {}
            if task_category not in categories:
                categories[task_category] = {
                    'count': 0,
                    'avg_time': 0,
                    'feedback_distribution': {}
                }
            
            cat_data = categories[task_category]
            cat_data['count'] += 1
            
            # Update average time (simple running average)
            cat_data['avg_time'] = (
                (cat_data['avg_time'] * (cat_data['count'] - 1) + task.estimated_duration_minutes) 
                / cat_data['count']
            )
            
            # Track feedback distribution
            feedback_dist = cat_data.get('feedback_distribution', {})
            feedback_dist[user_feedback] = feedback_dist.get(user_feedback, 0) + 1
            cat_data['feedback_distribution'] = feedback_dist
            
            ai_memory.task_categories = categories
        
        # Update performance metrics
        metrics = ai_memory.performance_metrics or {}
        
        # Calculate velocity factor (how user performs vs estimates)
        all_feedback = TaskFeedback.objects.filter(user=request.user).order_by('-timestamp')[:20]
        early_count = sum(1 for f in all_feedback if f.user_feedback == 'early')
        on_time_count = sum(1 for f in all_feedback if f.user_feedback == 'on_time')
        late_count = sum(1 for f in all_feedback if f.user_feedback in ['little_late', 'very_late'])
        total = len(all_feedback)
        
        if total > 0:
            metrics['on_time_rate'] = (on_time_count + early_count) / total
            metrics['tends_to_run_late'] = late_count > (early_count + on_time_count)
            
            if late_count > on_time_count:
                metrics['velocity_factor'] = 1.2  # Suggest 20% more time
            elif early_count > on_time_count:
                metrics['velocity_factor'] = 0.9  # Can do it faster
            else:
                metrics['velocity_factor'] = 1.0  # Right on target
        
        ai_memory.performance_metrics = metrics
        ai_memory.save()
        
        return Response({
            'feedback': TaskFeedbackSerializer(feedback).data,
            'message': 'Thanks for the feedback! This helps me learn.',
            'learned': f'Updated patterns for {task_category}' if task_category else 'Learning from your patterns!'
        }, status=status.HTTP_201_CREATED)
    
    except Task.DoesNotExist:
        return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f"[FEEDBACK ERROR] {str(e)}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def extract_task_category(task_title: str) -> str:
    """
    Extract a category from a task title (e.g., "Math151" from "Math151 Homework")
    Simple pattern matching - can be enhanced with NLP later
    """
    import re
    
    # Look for course codes (e.g., MATH151, BUS477, CS101)
    course_match = re.search(r'\b([A-Z]{2,4}\s?\d{3,4})\b', task_title, re.IGNORECASE)
    if course_match:
        return course_match.group(1).upper().replace(' ', '')
    
    # Look for common categories
    categories = ['homework', 'assignment', 'project', 'study', 'reading', 'essay', 'exam', 'quiz']
    for cat in categories:
        if cat in task_title.lower():
            return cat.capitalize()
    
    # Default: use first word if it's alphanumeric
    words = task_title.split()
    if words and words[0].isalnum():
        return words[0].capitalize()
    
    return None


@api_view(['GET', 'POST', 'PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def task_update(request, task_id):
    """Update a task"""
    try:
        task = Task.objects.get(id=task_id, user=request.user)
        
        # Handle duration update with calendar event update
        if 'estimated_minutes' in request.data:
            from datetime import timedelta
            
            old_duration = task.estimated_duration_minutes
            task.estimated_duration_minutes = request.data['estimated_minutes']
            
            # If task is scheduled, update the calendar event end time
            if task.calendar_event_id and task.scheduled_date and task.scheduled_time:
                try:
                    event_id = int(task.calendar_event_id.replace('app-', ''))
                    calendar_event = CalendarEvent.objects.get(id=event_id, user=request.user)
                    
                    # Update end time based on new duration
                    new_end = calendar_event.start_time + timedelta(minutes=request.data['estimated_minutes'])
                    calendar_event.end_time = new_end
                    calendar_event.save()
                    print(f"[TASK UPDATE] Updated calendar event {event_id} end time")
                except Exception as e:
                    print(f"[TASK UPDATE] Could not update calendar event: {e}")
            
            task.save()
            return Response(TaskSerializer(task).data)
        
        # Standard update
        serializer = TaskSerializer(task, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    except Task.DoesNotExist:
        return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def task_delete(request, task_id):
    """Delete a task and its associated calendar event"""
    try:
        task = Task.objects.get(id=task_id, user=request.user)
        
        # Delete associated calendar event if it exists
        if task.calendar_event_id:
            try:
                event_id = int(task.calendar_event_id.replace('app-', ''))
                CalendarEvent.objects.filter(id=event_id, user=request.user).delete()
                print(f"[TASK DELETE] Deleted calendar event {event_id} for task {task.id}")
            except Exception as e:
                print(f"[TASK DELETE] Could not delete calendar event: {e}")
        
        task.delete()
        return Response({'message': 'Task deleted'}, status=status.HTTP_204_NO_CONTENT)
    except Task.DoesNotExist:
        return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)


# ============================================================================
# CALENDAR EVENT VIEWS
# ============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def calendar_event_list(request):
    """Get all calendar events for the current user"""
    events = CalendarEvent.objects.filter(user=request.user)
    serializer = CalendarEventSerializer(events, many=True)
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def calendar_event_create(request):
    """Create a new calendar event"""
    print(f"[CREATE EVENT] User: {request.user.username}, Data: {request.data}")
    
    serializer = CalendarEventSerializer(data=request.data)
    if serializer.is_valid():
        event = serializer.save(user=request.user)
        print(f"[CREATE EVENT] Created event ID {event.id}: {event.title}")
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    print(f"[CREATE EVENT] Validation errors: {serializer.errors}")
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def calendar_event_update(request, event_id):
    """Update a calendar event"""
    try:
        event = CalendarEvent.objects.get(id=event_id, user=request.user)
        serializer = CalendarEventSerializer(event, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    except CalendarEvent.DoesNotExist:
        return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def calendar_event_delete(request, event_id):
    """Delete a calendar event"""
    try:
        event = CalendarEvent.objects.get(id=event_id, user=request.user)
        event.delete()
        return Response({'message': 'Event deleted'}, status=status.HTTP_204_NO_CONTENT)
    except CalendarEvent.DoesNotExist:
        return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)


# ============================================================================
# AI CHAT VIEW (Stub for MVP)
# ============================================================================

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_chat(request):
    """
    Chat with Clarity AI assistant - Now with task creation capability!
    The AI can detect when users want to create tasks and automatically create them.
    """
    user_message = request.data.get('message', '')
    
    if not user_message:
        return Response({'error': 'Message is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        if not settings.ANTHROPIC_API_KEY:
            return Response({
                'response': "Hi! I'm Clarity, your time awareness assistant. (AI chat is not configured yet, but I'm here to help!)"
            })
        
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        
        # Get AI memory for personalized responses
        ai_memory, _ = AIMemory.objects.get_or_create(user=request.user)
        
        # Get recent tasks and feedback for context
        recent_tasks = Task.objects.filter(user=request.user).order_by('-created_at')[:5]
        recent_feedback = TaskFeedback.objects.filter(user=request.user).order_by('-timestamp')[:5]
        
        task_context = "\n".join([f"- {task.title} ({task.status}, est: {task.estimated_duration_minutes}min)" for task in recent_tasks])
        
        # Build performance context
        performance_summary = ""
        if recent_feedback.exists():
            feedback_counts = {}
            for fb in recent_feedback:
                feedback_counts[fb.user_feedback] = feedback_counts.get(fb.user_feedback, 0) + 1
            performance_summary = "Recent performance: " + ", ".join([f"{k}: {v}x" for k, v in feedback_counts.items()])
        
        # Include AI memory context
        memory_context = ""
        if ai_memory.context_summary:
            memory_context = f"\n\nWhat I remember about you:\n{ai_memory.context_summary}"
        
        if ai_memory.task_categories:
            memory_context += f"\n\nYour task patterns:\n{json.dumps(ai_memory.task_categories, indent=2)}"
        
        # Include user preferences from onboarding
        preferences_context = ""
        if ai_memory.onboarding_data:
            prefs = ai_memory.onboarding_data
            pref_lines = []
            
            if 'work_rhythm' in prefs:
                rhythm_map = {
                    'early_bird': 'Early Bird (most productive 5am-9am)',
                    'morning_person': 'Morning Person (most productive 9am-12pm)',
                    'afternoon_warrior': 'Afternoon Warrior (most productive 12pm-5pm)',
                    'night_owl': 'Night Owl (most productive 9pm-2am)'
                }
                pref_lines.append(f"Work Rhythm: {rhythm_map.get(prefs['work_rhythm'], prefs['work_rhythm'])}")
            
            if 'break_preference' in prefs:
                break_map = {
                    'short_frequent': 'Prefers short breaks (5-10 min every hour)',
                    'medium': 'Prefers balanced breaks (15-20 min every 2 hours)',
                    'long_rare': 'Prefers long breaks (30+ min, less often)',
                    'no_schedule': 'Prefers flexible breaks (no fixed schedule)'
                }
                pref_lines.append(f"Break Style: {break_map.get(prefs['break_preference'], prefs['break_preference'])}")
            
            if 'work_style' in prefs:
                work_map = {
                    'sprint': 'Quick Sprints (20-30 min focused bursts)',
                    'standard': 'Standard Blocks (45-60 min sessions)',
                    'deep_dive': 'Deep Dive (90+ min flow state sessions)',
                    'flexible': 'Flexible approach (adapts to task)',
                    'marathon': 'Marathon Sessions (2-3 hours deep work)',
                    'balanced': 'Balanced Blocks (45-90 min sustainable pace)'
                }
                pref_lines.append(f"Work Style: {work_map.get(prefs['work_style'], prefs['work_style'])}")
            
            if 'planning_style' in prefs:
                plan_map = {
                    'detailed': 'Detailed Planning (every minute planned)',
                    'rough_outline': 'Rough Outline (knows the big stuff)',
                    'priorities': 'Priority-Based (top 3 things)',
                    'spontaneous': 'Spontaneous (wings it)',
                    'structured': 'Structured Blocks (morning/afternoon/evening)',
                    'loose': 'Loose Framework (just essentials)'
                }
                pref_lines.append(f"Planning Style: {plan_map.get(prefs['planning_style'], prefs['planning_style'])}")
            
            if pref_lines:
                preferences_context = f"\n\nUser Preferences:\n" + "\n".join([f"- {line}" for line in pref_lines])
        
        # Get current date and time for relative date parsing
        from datetime import date, time as dt_time, datetime
        now = datetime.now()
        today = now.date()
        today_str = today.strftime('%Y-%m-%d')
        current_time = now.strftime('%I:%M %p')  # e.g., "02:30 PM"
        current_time_24h = now.strftime('%H:%M')  # e.g., "14:30"
        
        # Get last discussed task for context continuity
        last_task_context = ""
        if ai_memory.work_patterns and 'last_task_id' in ai_memory.work_patterns:
            try:
                last_task_id = ai_memory.work_patterns['last_task_id']
                last_task = Task.objects.get(id=last_task_id, user=request.user)
                last_task_context = f"\n\nLast discussed task: ID:{last_task.id} - '{last_task.title}' ({last_task.status})"
            except Task.DoesNotExist:
                pass
        
        system_prompt = f"""You are Clarity, a friendly time-awareness assistant for users with time blindness.

Today's date: {today_str}
Current time: {current_time} ({current_time_24h})

Recent tasks: {task_context[:200] if task_context else "None yet"}
{performance_summary[:100] if performance_summary else ""}
{memory_context[:300] if memory_context else ""}
{preferences_context}
{last_task_context}

You can create AND update tasks. Be supportive, concise, and ACTION-ORIENTED.

IMPORTANT: Use the user's preferences above when:
- Scheduling tasks (consider their productive hours from Work Rhythm)
- Estimating task duration (use their Work Style - sprints vs marathons)
- Breaking down tasks (align with their Break Style and Work Style)
- Suggesting times (match their Planning Style - detailed vs spontaneous)

IMPORTANT - Time Awareness:
- Use current time to check if tasks are overdue or coming up soon
- Can ask "did you finish [task]?" to help users mark tasks complete
- When discussing a specific task, remember its ID for follow-up questions
- If user confirms completion, use update_task with mark_complete=true

When creating tasks:
- Parse dates: "today", "tomorrow", "next Monday", specific dates
- Parse times: "2pm", "14:00", "afternoon"="14:00", "evening"="18:00", "morning"="09:00"
- Estimate duration based on user's work_style preference
- If user asks about preferences, tell them what you know from the User Preferences section

When user wants to UPDATE (move, change, reschedule):
- Keywords: "move it", "change it", "make it", "nevermind", "actually", "reschedule"
- CRITICAL: If user just created a task and says "move it" or "change it", they mean UPDATE, not create new!
1. Search for the task using search_tasks with keywords from their message
2. If found, IMMEDIATELY use update_task with the changes
3. Don't ask for confirmation unless deleting - just do it and confirm after
4. For vague times like "evening", use 18:00 (6pm)

Be proactive - when user says "make it evening" or "change to tomorrow", search and update right away."""

        # Define tool for task creation
        tools = [
            {
                "name": "create_task",
                "description": "Create a new task. When user says 'afternoon' use 14:00, 'evening' use 18:00, 'morning' use 09:00. Parse 'tomorrow' as the next day's date. If priority or location not mentioned, ask user before creating.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Brief title for the task (e.g., 'Team meeting', 'Study for exam', 'Call dentist')"
                        },
                        "description": {
                            "type": "string",
                            "description": "Additional context or notes about the task"
                        },
                        "estimated_minutes": {
                            "type": "integer",
                            "description": "Estimated duration in minutes. Default: 30 for meetings, 60 for study/work, 15 for quick tasks"
                        },
                        "scheduled_date": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format. Parse 'today', 'tomorrow', day names, or specific dates. Leave null if no date mentioned."
                        },
                        "scheduled_time": {
                            "type": "string",
                            "description": "Time in HH:MM 24-hour format (e.g., '14:00' for 2pm). Leave null if no time mentioned."
                        },
                        "priority": {
                            "type": "string",
                            "description": "Task priority: 'low', 'medium', or 'high'. Ask user if not specified. Default to 'medium' if truly unclear."
                        },
                        "location": {
                            "type": "string",
                            "description": "Location for the task (optional). Ask user if they want to add a location. Can be left null."
                        }
                    },
                    "required": ["title"]
                }
            },
            {
                "name": "create_task_with_breakdown",
                "description": "Create a task WITH subtasks when user confirms they want the breakdown. Use the stored breakdown data from the previous tool result.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Main task title"
                        },
                        "description": {
                            "type": "string",
                            "description": "Task description"
                        },
                        "subtasks": {
                            "type": "array",
                            "description": "Array of subtasks with title, estimated_minutes, description",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "estimated_minutes": {"type": "integer"},
                                    "description": {"type": "string"}
                                }
                            }
                        },
                        "scheduled_date": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format if scheduling"
                        },
                        "scheduled_time": {
                            "type": "string",
                            "description": "Time in HH:MM format if scheduling"
                        }
                    },
                    "required": ["title", "subtasks"]
                }
            },
            {
                "name": "list_tasks",
                "description": "List tasks for a specific date or by status. Use this when user asks 'what tasks do I have today/tomorrow' or 'show me my tasks'. Returns all matching tasks with IDs.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "date": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format to filter tasks (optional). Use today's date if user asks 'today', tomorrow's date for 'tomorrow', etc."
                        },
                        "status": {
                            "type": "string",
                            "description": "Filter by status: 'pending', 'in_progress', 'done' (optional). Default to 'pending' if asking about upcoming/scheduled tasks."
                        }
                    },
                    "required": []
                }
            },
            {
                "name": "search_tasks",
                "description": "Search for tasks by keywords. Always use this FIRST when user wants to update/change a task. Returns task IDs needed for updates.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "search_term": {
                            "type": "string",
                            "description": "Keyword from the task title to search for (e.g., 'meeting', 'study', 'dentist')"
                        }
                    },
                    "required": ["search_term"]
                }
            },
            {
                "name": "update_task",
                "description": "Update a task immediately. Use right after search_tasks. For reschedules, just do it - user already asked. Only ask confirmation for deletions.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "integer",
                            "description": "ID of the task to update (from search_tasks result)"
                        },
                        "new_date": {
                            "type": "string",
                            "description": "New date in YYYY-MM-DD format if rescheduling"
                        },
                        "new_time": {
                            "type": "string",
                            "description": "New time in HH:MM format if rescheduling"
                        },
                        "new_duration": {
                            "type": "integer",
                            "description": "New duration in minutes if changing"
                        },
                        "new_priority": {
                            "type": "string",
                            "description": "New priority level: 'low', 'medium', or 'high' if changing priority"
                        },
                        "new_location": {
                            "type": "string",
                            "description": "New location for the task if changing location"
                        },
                        "mark_complete": {
                            "type": "boolean",
                            "description": "Set to true to mark task as complete"
                        },
                        "delete_task": {
                            "type": "boolean",
                            "description": "Set to true to delete the task"
                        }
                    },
                    "required": ["task_id"]
                }
            }
        ]

        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=1024,
            system=system_prompt,
            tools=tools,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        # Check if AI wants to use tools
        created_tasks = []
        tool_results = []  # Initialize here so it's always defined
        
        if message.stop_reason == "tool_use":
            # Process tool calls
            
            for content_block in message.content:
                if hasattr(content_block, 'type') and content_block.type == "tool_use":
                    tool_name = content_block.name
                    tool_input = content_block.input
                    
                    if tool_name == "create_task":
                        try:
                            task_title = tool_input['title']
                            task_description = tool_input.get('description', '')
                            
                            # Check if task should be broken down using the same logic as task_breakdown_analyze
                            try:
                                breakdown_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
                                breakdown_prompt = f"""Analyze if this task needs breakdown into subtasks.

Task: "{task_title}"
{f'Details: {task_description[:100]}' if task_description else ''}

Break down if: >90min, multi-step, or complex.

Respond with ONLY valid JSON:
{{
  "should_break_down": true/false,
  "suggested_subtasks": [
    {{"title": "Short title", "estimated_minutes": 30, "description": "Brief"}},
  ],
  "witty_message": "Brief msg"
}}

If no breakdown needed, return empty suggested_subtasks array."""

                                breakdown_msg = breakdown_client.messages.create(
                                    model="claude-3-haiku-20240307",
                                    max_tokens=1024,
                                    messages=[{"role": "user", "content": breakdown_prompt}]
                                )
                                
                                breakdown_text = breakdown_msg.content[0].text
                                if '```json' in breakdown_text:
                                    json_str = breakdown_text.split('```json')[1].split('```')[0].strip()
                                elif '```' in breakdown_text:
                                    json_str = breakdown_text.split('```')[1].split('```')[0].strip()
                                else:
                                    json_str = breakdown_text
                                
                                breakdown_data = json.loads(json_str)
                                should_breakdown = breakdown_data.get('should_break_down', False)
                                suggested_subtasks = breakdown_data.get('suggested_subtasks', [])
                                
                            except Exception as bd_error:
                                print(f"[AI CHAT] Breakdown check failed: {bd_error}")
                                should_breakdown = False
                                suggested_subtasks = []
                            
                            # If should break down, ask user first
                            if should_breakdown and suggested_subtasks and len(suggested_subtasks) > 1:
                                subtask_summary = ', '.join([st['title'] for st in suggested_subtasks[:3]])
                                if len(suggested_subtasks) > 3:
                                    subtask_summary += f' and {len(suggested_subtasks) - 3} more'
                                
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"BREAKDOWN_NEEDED: '{task_title}' looks complex! I can break it into {len(suggested_subtasks)} subtasks: {subtask_summary}. Ask the user if they want the breakdown or keep it as one task. Store this data: {json.dumps({'title': task_title, 'description': task_description, 'estimated_minutes': tool_input.get('estimated_minutes', 30), 'scheduled_date': tool_input.get('scheduled_date'), 'scheduled_time': tool_input.get('scheduled_time'), 'subtasks': suggested_subtasks})}"
                                })
                                continue
                            
                            # Create the task (simple task or no breakdown)
                            task_data = {
                                'title': task_title,
                                'description': task_description,
                                'estimated_duration_minutes': tool_input.get('estimated_minutes', 30),
                                'priority': tool_input.get('priority', 'medium'),
                                'location': tool_input.get('location', ''),
                            }
                            
                            task = Task.objects.create(
                                user=request.user,
                                **task_data,
                                status='pending',
                                ai_friendly_message='Created via AI chat'
                            )
                            
                            # Schedule if date/time provided
                            scheduled_info = ""
                            if tool_input.get('scheduled_date') and tool_input.get('scheduled_time'):
                                try:
                                    scheduled_date = datetime.strptime(tool_input['scheduled_date'], '%Y-%m-%d').date()
                                    scheduled_time = datetime.strptime(tool_input['scheduled_time'], '%H:%M').time()
                                    
                                    # Create calendar event
                                    naive_start = datetime.combine(scheduled_date, scheduled_time)
                                    naive_end = naive_start + timedelta(minutes=task.estimated_duration_minutes)
                                    
                                    local_tz = pytz.timezone('America/Los_Angeles')
                                    start_datetime = local_tz.localize(naive_start)
                                    end_datetime = local_tz.localize(naive_end)
                                    
                                    calendar_event = CalendarEvent.objects.create(
                                        user=request.user,
                                        title=f"🎯 {task.title}",
                                        description=f"Task: {task.title}\nEstimated duration: {task.estimated_duration_minutes} min",
                                        start_time=start_datetime,
                                        end_time=end_datetime,
                                        all_day=False,
                                        color='#6366f1'
                                    )
                                    
                                    task.scheduled_date = scheduled_date
                                    task.scheduled_time = scheduled_time
                                    task.calendar_event_id = f'app-{calendar_event.id}'
                                    task.save()
                                    
                                    scheduled_info = f" scheduled for {scheduled_date} at {scheduled_time}"
                                except Exception as e:
                                    print(f"[AI CHAT] Error scheduling task: {e}")
                            
                            created_tasks.append(task)
                            
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Task created successfully: '{task.title}'{scheduled_info}"
                            })
                            
                        except Exception as e:
                            print(f"[AI CHAT] Error creating task: {e}")
                            import traceback
                            traceback.print_exc()
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Error creating task: {str(e)}"
                            })
                    
                    elif tool_name == "create_task_with_breakdown":
                        try:
                            task_title = tool_input['title']
                            task_description = tool_input.get('description', '')
                            subtasks_data = tool_input.get('subtasks', [])
                            
                            # Calculate total duration from subtasks
                            total_duration = sum(st.get('estimated_minutes', 30) for st in subtasks_data)
                            
                            # Create main task
                            main_task = Task.objects.create(
                                user=request.user,
                                title=task_title,
                                description=task_description,
                                estimated_duration_minutes=total_duration,
                                status='pending',
                                priority=tool_input.get('priority', 'medium'),
                                location=tool_input.get('location', ''),
                                ai_friendly_message='Created via AI chat with breakdown'
                            )
                            
                            # Create subtasks
                            for subtask_data in subtasks_data:
                                Task.objects.create(
                                    user=request.user,
                                    parent_task=main_task,
                                    title=subtask_data.get('title', 'Subtask'),
                                    description=subtask_data.get('description', ''),
                                    estimated_duration_minutes=subtask_data.get('estimated_minutes', 30),
                                    status='pending'
                                )
                            
                            # Schedule if date/time provided
                            scheduled_info = ""
                            if tool_input.get('scheduled_date') and tool_input.get('scheduled_time'):
                                try:
                                    scheduled_date = datetime.strptime(tool_input['scheduled_date'], '%Y-%m-%d').date()
                                    scheduled_time = datetime.strptime(tool_input['scheduled_time'], '%H:%M').time()
                                    
                                    naive_start = datetime.combine(scheduled_date, scheduled_time)
                                    naive_end = naive_start + timedelta(minutes=main_task.estimated_duration_minutes)
                                    
                                    local_tz = pytz.timezone('America/Los_Angeles')
                                    start_datetime = local_tz.localize(naive_start)
                                    end_datetime = local_tz.localize(naive_end)
                                    
                                    calendar_event = CalendarEvent.objects.create(
                                        user=request.user,
                                        title=f"🎯 {main_task.title}",
                                        description=f"Task: {main_task.title}\nWith {len(subtasks_data)} subtasks",
                                        start_time=start_datetime,
                                        end_time=end_datetime,
                                        all_day=False,
                                        color='#6366f1'
                                    )
                                    
                                    main_task.scheduled_date = scheduled_date
                                    main_task.scheduled_time = scheduled_time
                                    main_task.calendar_event_id = f'app-{calendar_event.id}'
                                    main_task.save()
                                    
                                    scheduled_info = f" scheduled for {scheduled_date} at {scheduled_time}"
                                except Exception as e:
                                    print(f"[AI CHAT] Error scheduling breakdown task: {e}")
                            
                            created_tasks.append(main_task)
                            
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Task created with {len(subtasks_data)} subtasks: '{task_title}'{scheduled_info}"
                            })
                            
                        except Exception as e:
                            print(f"[AI CHAT] Error creating breakdown task: {e}")
                            import traceback
                            traceback.print_exc()
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Error creating breakdown task: {str(e)}"
                            })
                    
                    elif tool_name == "list_tasks":
                        try:
                            filter_date = tool_input.get('date')
                            filter_status = tool_input.get('status', 'pending')
                            
                            # Build query
                            query = Task.objects.filter(user=request.user)
                            
                            if filter_date:
                                query = query.filter(scheduled_date=filter_date)
                            
                            if filter_status:
                                query = query.filter(status=filter_status)
                            
                            tasks = query.order_by('scheduled_time', 'created_at')[:20]
                            
                            if not tasks.exists():
                                date_str = f" for {filter_date}" if filter_date else ""
                                status_str = f" with status '{filter_status}'" if filter_status else ""
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"No tasks found{date_str}{status_str}."
                                })
                            else:
                                results = []
                                for task in tasks:
                                    task_info = f"ID:{task.id} - '{task.title}'"
                                    if task.scheduled_date and task.scheduled_time:
                                        task_info += f" at {task.scheduled_time}"
                                    elif task.scheduled_date:
                                        task_info += f" (no specific time)"
                                    else:
                                        task_info += " (not scheduled)"
                                    
                                    if task.priority:
                                        task_info += f" [{task.priority} priority]"
                                    if task.location:
                                        task_info += f" @ {task.location}"
                                    
                                    task_info += f" - {task.estimated_duration_minutes}min"
                                    results.append(task_info)
                                
                                date_str = f" for {filter_date}" if filter_date else ""
                                status_str = f" ({filter_status})" if filter_status else ""
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"Found {len(results)} task(s){date_str}{status_str}:\n" + "\n".join(results)
                                })
                            
                        except Exception as e:
                            print(f"[AI CHAT] Error listing tasks: {e}")
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Error listing tasks: {str(e)}"
                            })
                    
                    elif tool_name == "search_tasks":
                        try:
                            search_term = tool_input.get('search_term', '').lower()
                            
                            # Search in user's tasks
                            matching_tasks = Task.objects.filter(
                                user=request.user,
                                title__icontains=search_term
                            ).order_by('-created_at')[:5]
                            
                            if not matching_tasks.exists():
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"No tasks found matching '{search_term}'. User has no tasks with that keyword."
                                })
                            else:
                                results = []
                                for task in matching_tasks:
                                    task_info = f"ID:{task.id} - '{task.title}'"
                                    if task.scheduled_date and task.scheduled_time:
                                        task_info += f" (scheduled {task.scheduled_date} at {task.scheduled_time})"
                                    elif task.scheduled_date:
                                        task_info += f" (scheduled {task.scheduled_date})"
                                    else:
                                        task_info += " (not scheduled)"
                                    task_info += f" - {task.status}, {task.estimated_duration_minutes}min"
                                    results.append(task_info)
                                
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"Found {len(results)} task(s) matching '{search_term}':\\n" + "\\n".join(results)
                                })
                            
                        except Exception as e:
                            print(f"[AI CHAT] Error searching tasks: {e}")
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Error searching tasks: {str(e)}"
                            })
                    
                    elif tool_name == "update_task":
                        try:
                            task_id = tool_input.get('task_id')
                            
                            # Get the task
                            task = Task.objects.get(id=task_id, user=request.user)
                            changes = []
                            
                            # Handle deletion
                            if tool_input.get('delete_task'):
                                task_title = task.title
                                if task.calendar_event_id:
                                    try:
                                        event_id = int(task.calendar_event_id.replace('app-', ''))
                                        CalendarEvent.objects.filter(id=event_id, user=request.user).delete()
                                    except:
                                        pass
                                task.delete()
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"Task '{task_title}' deleted successfully."
                                })
                                continue
                            
                            # Handle completion
                            if tool_input.get('mark_complete'):
                                task.status = 'done'
                                changes.append("marked as complete")
                            
                            # Handle priority change
                            if tool_input.get('new_priority'):
                                old_priority = task.priority or 'medium'
                                task.priority = tool_input['new_priority']
                                changes.append(f"priority changed from {old_priority} to {tool_input['new_priority']}")
                            
                            # Handle location change
                            if tool_input.get('new_location') is not None:
                                old_location = task.location or 'none'
                                task.location = tool_input['new_location']
                                if tool_input['new_location']:
                                    changes.append(f"location changed to '{tool_input['new_location']}'")
                                else:
                                    changes.append("location removed")
                            
                            # Handle duration change
                            if tool_input.get('new_duration'):
                                old_duration = task.estimated_duration_minutes
                                task.estimated_duration_minutes = tool_input['new_duration']
                                changes.append(f"duration changed from {old_duration}min to {tool_input['new_duration']}min")
                                
                                # Update calendar event if exists
                                if task.calendar_event_id and task.scheduled_date and task.scheduled_time:
                                    try:
                                        event_id = int(task.calendar_event_id.replace('app-', ''))
                                        calendar_event = CalendarEvent.objects.get(id=event_id, user=request.user)
                                        new_end = calendar_event.start_time + timedelta(minutes=tool_input['new_duration'])
                                        calendar_event.end_time = new_end
                                        calendar_event.save()
                                    except Exception as e:
                                        print(f"[AI CHAT] Error updating calendar duration: {e}")
                            
                            # Handle reschedule
                            if tool_input.get('new_date') or tool_input.get('new_time'):
                                new_date = tool_input.get('new_date')
                                new_time = tool_input.get('new_time')
                                
                                # Use existing values if not provided
                                if not new_date and task.scheduled_date:
                                    new_date = str(task.scheduled_date)
                                if not new_time and task.scheduled_time:
                                    new_time = str(task.scheduled_time)
                                
                                if new_date and new_time:
                                    scheduled_date = datetime.strptime(new_date, '%Y-%m-%d').date()
                                    scheduled_time = datetime.strptime(new_time, '%H:%M').time()
                                    
                                    old_schedule = ""
                                    if task.scheduled_date and task.scheduled_time:
                                        old_schedule = f"from {task.scheduled_date} at {task.scheduled_time} "
                                    
                                    changes.append(f"rescheduled {old_schedule}to {new_date} at {new_time}")
                                    
                                    # Update or create calendar event
                                    naive_start = datetime.combine(scheduled_date, scheduled_time)
                                    naive_end = naive_start + timedelta(minutes=task.estimated_duration_minutes)
                                    
                                    local_tz = pytz.timezone('America/Los_Angeles')
                                    start_datetime = local_tz.localize(naive_start)
                                    end_datetime = local_tz.localize(naive_end)
                                    
                                    if task.calendar_event_id:
                                        # Update existing
                                        try:
                                            event_id = int(task.calendar_event_id.replace('app-', ''))
                                            calendar_event = CalendarEvent.objects.get(id=event_id, user=request.user)
                                            calendar_event.start_time = start_datetime
                                            calendar_event.end_time = end_datetime
                                            calendar_event.save()
                                        except Exception as e:
                                            print(f"[AI CHAT] Error updating calendar: {e}")
                                    else:
                                        # Create new
                                        calendar_event = CalendarEvent.objects.create(
                                            user=request.user,
                                            title=f"🎯 {task.title}",
                                            description=f"Task: {task.title}",
                                            start_time=start_datetime,
                                            end_time=end_datetime,
                                            all_day=False,
                                            color='#6366f1'
                                        )
                                        task.calendar_event_id = f'app-{calendar_event.id}'
                                    
                                    task.scheduled_date = scheduled_date
                                    task.scheduled_time = scheduled_time
                            
                            task.save()
                            
                            if changes:
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"Task '{task.title}' updated: {', '.join(changes)}"
                                })
                            else:
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": content_block.id,
                                    "content": f"Task '{task.title}' - no changes made"
                                })
                            
                        except Task.DoesNotExist:
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Task with ID {task_id} not found or doesn't belong to user"
                            })
                        except Exception as e:
                            print(f"[AI CHAT] Error updating task: {e}")
                            import traceback
                            traceback.print_exc()
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": content_block.id,
                                "content": f"Error updating task: {str(e)}"
                            })
            
            # Continue conversation with tool results - LOOP until no more tools needed
            if tool_results:
                conversation_messages = [
                    {"role": "user", "content": user_message},
                    {"role": "assistant", "content": message.content},
                    {"role": "user", "content": tool_results}
                ]
                
                # Keep processing tool calls until AI gives a text response
                max_iterations = 5
                iteration = 0
                response_text = ""  # Initialize before loop
                while iteration < max_iterations:
                    iteration += 1
                    
                    follow_up = client.messages.create(
                        model="claude-3-haiku-20240307",
                        max_tokens=512,
                        system=system_prompt,
                        tools=tools,
                        messages=conversation_messages
                    )
                    
                    # Check if this response has tool calls
                    if follow_up.stop_reason == "tool_use":
                        # Process these tool calls too!
                        follow_up_tool_results = []
                        
                        for content_block in follow_up.content:
                            if hasattr(content_block, 'type') and content_block.type == "tool_use":
                                tool_name = content_block.name
                                tool_input = content_block.input
                                
                                # Handle list_tasks
                                if tool_name == "list_tasks":
                                    try:
                                        filter_date = tool_input.get('date')
                                        filter_status = tool_input.get('status', 'pending')
                                        
                                        query = Task.objects.filter(user=request.user)
                                        
                                        if filter_date:
                                            query = query.filter(scheduled_date=filter_date)
                                        
                                        if filter_status:
                                            query = query.filter(status=filter_status)
                                        
                                        tasks = query.order_by('scheduled_time', 'created_at')[:20]
                                        
                                        if not tasks.exists():
                                            date_str = f" for {filter_date}" if filter_date else ""
                                            status_str = f" with status '{filter_status}'" if filter_status else ""
                                            follow_up_tool_results.append({
                                                "type": "tool_result",
                                                "tool_use_id": content_block.id,
                                                "content": f"No tasks found{date_str}{status_str}."
                                            })
                                        else:
                                            results = []
                                            for task in tasks:
                                                task_info = f"ID:{task.id} - '{task.title}'"
                                                if task.scheduled_date and task.scheduled_time:
                                                    task_info += f" at {task.scheduled_time}"
                                                elif task.scheduled_date:
                                                    task_info += f" (no specific time)"
                                                else:
                                                    task_info += " (not scheduled)"
                                                
                                                if task.priority:
                                                    task_info += f" [{task.priority} priority]"
                                                if task.location:
                                                    task_info += f" @ {task.location}"
                                                
                                                task_info += f" - {task.estimated_duration_minutes}min"
                                                results.append(task_info)
                                            
                                            date_str = f" for {filter_date}" if filter_date else ""
                                            status_str = f" ({filter_status})" if filter_status else ""
                                            follow_up_tool_results.append({
                                                "type": "tool_result",
                                                "tool_use_id": content_block.id,
                                                "content": f"Found {len(results)} task(s){date_str}{status_str}:\n" + "\n".join(results)
                                            })
                                        
                                    except Exception as e:
                                        print(f"[AI CHAT] Error listing tasks: {e}")
                                        follow_up_tool_results.append({
                                            "type": "tool_result",
                                            "tool_use_id": content_block.id,
                                            "content": f"Error listing tasks: {str(e)}"
                                        })
                                
                                # Handle search_tasks
                                elif tool_name == "search_tasks":
                                    try:
                                        search_term = tool_input.get('search_term', '').lower()
                                        matching_tasks = Task.objects.filter(
                                            user=request.user,
                                            title__icontains=search_term
                                        ).order_by('-created_at')[:5]
                                        
                                        if not matching_tasks.exists():
                                            follow_up_tool_results.append({
                                                "type": "tool_result",
                                                "tool_use_id": content_block.id,
                                                "content": f"No tasks found matching '{search_term}'."
                                            })
                                        else:
                                            results = []
                                            for task in matching_tasks:
                                                task_info = f"ID:{task.id} - '{task.title}'"
                                                if task.scheduled_date and task.scheduled_time:
                                                    task_info += f" (scheduled {task.scheduled_date} at {task.scheduled_time})"
                                                task_info += f" - {task.status}, {task.estimated_duration_minutes}min"
                                                results.append(task_info)
                                            
                                            follow_up_tool_results.append({
                                                "type": "tool_result",
                                                "tool_use_id": content_block.id,
                                                "content": f"Found {len(results)} task(s):\n" + "\n".join(results)
                                            })
                                    except Exception as e:
                                        follow_up_tool_results.append({
                                            "type": "tool_result",
                                            "tool_use_id": content_block.id,
                                            "content": f"Error: {str(e)}"
                                        })
                                
                                # Handle update_task
                                elif tool_name == "update_task":
                                    try:
                                        task_id = tool_input.get('task_id')
                                        task = Task.objects.get(id=task_id, user=request.user)
                                        changes = []
                                        
                                        # Handle deletion
                                        if tool_input.get('delete_task'):
                                            task_title = task.title
                                            if task.calendar_event_id:
                                                try:
                                                    event_id = int(task.calendar_event_id.replace('app-', ''))
                                                    CalendarEvent.objects.filter(id=event_id, user=request.user).delete()
                                                except:
                                                    pass
                                            task.delete()
                                            follow_up_tool_results.append({
                                                "type": "tool_result",
                                                "tool_use_id": content_block.id,
                                                "content": f"Task '{task_title}' deleted."
                                            })
                                            continue
                                        
                                        # Handle priority change
                                        if tool_input.get('new_priority'):
                                            old_priority = task.priority or 'medium'
                                            task.priority = tool_input['new_priority']
                                            changes.append(f"priority changed from {old_priority} to {tool_input['new_priority']}")
                                        
                                        # Handle location change
                                        if tool_input.get('new_location') is not None:
                                            old_location = task.location or 'none'
                                            task.location = tool_input['new_location']
                                            if tool_input['new_location']:
                                                changes.append(f"location changed to '{tool_input['new_location']}'")
                                            else:
                                                changes.append("location removed")
                                        
                                        # Handle reschedule
                                        if tool_input.get('new_date') or tool_input.get('new_time'):
                                            new_date = tool_input.get('new_date')
                                            new_time = tool_input.get('new_time')
                                            
                                            if not new_date and task.scheduled_date:
                                                new_date = str(task.scheduled_date)
                                            if not new_time and task.scheduled_time:
                                                new_time = str(task.scheduled_time)
                                            
                                            if new_date and new_time:
                                                scheduled_date = datetime.strptime(new_date, '%Y-%m-%d').date()
                                                scheduled_time = datetime.strptime(new_time, '%H:%M').time()
                                                
                                                changes.append(f"rescheduled to {new_date} at {new_time}")
                                                
                                                naive_start = datetime.combine(scheduled_date, scheduled_time)
                                                naive_end = naive_start + timedelta(minutes=task.estimated_duration_minutes)
                                                local_tz = pytz.timezone('America/Los_Angeles')
                                                start_datetime = local_tz.localize(naive_start)
                                                end_datetime = local_tz.localize(naive_end)
                                                
                                                if task.calendar_event_id:
                                                    try:
                                                        event_id = int(task.calendar_event_id.replace('app-', ''))
                                                        calendar_event = CalendarEvent.objects.get(id=event_id, user=request.user)
                                                        calendar_event.start_time = start_datetime
                                                        calendar_event.end_time = end_datetime
                                                        calendar_event.save()
                                                    except:
                                                        pass
                                                else:
                                                    calendar_event = CalendarEvent.objects.create(
                                                        user=request.user,
                                                        title=f"🎯 {task.title}",
                                                        description=f"Task: {task.title}",
                                                        start_time=start_datetime,
                                                        end_time=end_datetime,
                                                        all_day=False,
                                                        color='#6366f1'
                                                    )
                                                    task.calendar_event_id = f'app-{calendar_event.id}'
                                                
                                                task.scheduled_date = scheduled_date
                                                task.scheduled_time = scheduled_time
                                        
                                        # Handle duration
                                        if tool_input.get('new_duration'):
                                            task.estimated_duration_minutes = tool_input['new_duration']
                                            changes.append(f"duration changed to {tool_input['new_duration']}min")
                                        
                                        # Handle completion
                                        if tool_input.get('mark_complete'):
                                            task.status = 'done'
                                            changes.append("marked as complete")
                                        
                                        task.save()
                                        
                                        follow_up_tool_results.append({
                                            "type": "tool_result",
                                            "tool_use_id": content_block.id,
                                            "content": f"Task '{task.title}' updated: {', '.join(changes)}" if changes else f"Task '{task.title}' - no changes"
                                        })
                                        
                                    except Task.DoesNotExist:
                                        follow_up_tool_results.append({
                                            "type": "tool_result",
                                            "tool_use_id": content_block.id,
                                            "content": f"Task with ID {task_id} not found"
                                        })
                                    except Exception as e:
                                        follow_up_tool_results.append({
                                            "type": "tool_result",
                                            "tool_use_id": content_block.id,
                                            "content": f"Error: {str(e)}"
                                        })
                        
                        # Add this round to conversation and continue
                        if follow_up_tool_results:
                            conversation_messages.append({"role": "assistant", "content": follow_up.content})
                            conversation_messages.append({"role": "user", "content": follow_up_tool_results})
                            continue
                    
                    # No more tool calls - get final text response
                    response_text = ""
                    for block in follow_up.content:
                        if hasattr(block, 'text'):
                            response_text += block.text
                    break
                
                # If we hit max iterations without text response
                if not response_text:
                    response_text = "Done! Let me know if you need anything else."
            else:
                # No tools were actually used, get text from original message
                response_text = ""
                for block in message.content:
                    if hasattr(block, 'text'):
                        response_text += block.text
        else:
            # No tool use, just get the text response
            response_text = ""
            for block in message.content:
                if hasattr(block, 'text'):
                    response_text += block.text
        
        response_text = response_text.strip() or "I've created that task for you!"
        
        # Track last discussed task for context continuity
        last_task_mentioned = None
        for tool_result_block in tool_results if tool_results else []:
            if hasattr(tool_result_block, 'get') and 'content' in tool_result_block:
                content = tool_result_block['content']
                # Extract task ID from search/update/create results
                import re
                task_id_match = re.search(r'ID:(\d+)', content)
                if task_id_match:
                    last_task_mentioned = task_id_match.group(1)
        
        # Update AI memory context (append to summary, will be compressed periodically)
        if ai_memory.context_summary:
            ai_memory.context_summary += f"\n[User]: {user_message[:100]}... [AI]: {response_text[:100]}..."
        else:
            ai_memory.context_summary = f"[User]: {user_message[:100]}... [AI]: {response_text[:100]}..."
        
        # Store last discussed task for continuity
        if last_task_mentioned:
            if not ai_memory.work_patterns:
                ai_memory.work_patterns = {}
            ai_memory.work_patterns['last_task_id'] = last_task_mentioned
        
        # Compress context if getting too long (>5000 chars)
        if len(ai_memory.context_summary) > 5000:
            ai_memory.context_summary = compress_context(ai_memory.context_summary)
        
        ai_memory.save()
        
        # Return response with created tasks info
        response_data = {'response': response_text}
        if created_tasks:
            response_data['tasks_created'] = [
                {
                    'id': task.id,
                    'title': task.title,
                    'scheduled_date': str(task.scheduled_date) if task.scheduled_date else None,
                    'scheduled_time': str(task.scheduled_time) if task.scheduled_time else None
                } for task in created_tasks
            ]
        
        return Response(response_data)
    
    except Exception as e:
        # Log the full error for debugging
        import traceback
        error_details = traceback.format_exc()
        print(f"[AI CHAT ERROR] {str(e)}")
        print(f"[AI CHAT ERROR DETAILS] {error_details}")
        
        # Provide more helpful error message based on error type
        if "api_key" in str(e).lower() or "authentication" in str(e).lower():
            error_msg = "AI chat is not properly configured. Please check the API key."
        elif "rate" in str(e).lower() or "quota" in str(e).lower():
            error_msg = "AI service is currently at capacity. Please try again in a moment."
        elif "network" in str(e).lower() or "connection" in str(e).lower():
            error_msg = "Having trouble connecting to AI service. Check your internet connection."
        else:
            error_msg = "Sorry, I'm having trouble connecting right now. Please try again!"
        
        return Response({
            'response': error_msg,
            'debug_error': str(e) if settings.DEBUG else None,
            'error_type': type(e).__name__ if settings.DEBUG else None
        }, status=status.HTTP_200_OK)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def ai_memory_view(request):
    """Get or update AI memory for personalization"""
    ai_memory, _ = AIMemory.objects.get_or_create(user=request.user)
    
    if request.method == 'GET':
        return Response(AIMemorySerializer(ai_memory).data)
    
    elif request.method == 'PATCH':
        serializer = AIMemorySerializer(ai_memory, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_onboarding(request):
    """
    Handle AI onboarding questions and responses to learn about the user.
    Called during first chat interaction or explicitly.
    """
    responses = request.data.get('responses', {})
    onboarding_completed = request.data.get('onboarding_completed', True)
    
    ai_memory, _ = AIMemory.objects.get_or_create(user=request.user)
    
    # Store onboarding data
    ai_memory.onboarding_data = responses
    ai_memory.onboarding_completed = onboarding_completed
    
    # Extract patterns from onboarding
    if 'work_style' in responses:
        ai_memory.work_patterns['work_style'] = responses['work_style']
    
    if 'typical_challenges' in responses:
        ai_memory.context_summary = f"User struggles with: {responses['typical_challenges']}"
    
    if 'preferred_communication' in responses:
        ai_memory.communication_style = responses['preferred_communication']
    
    ai_memory.save()
    
    return Response({
        'message': 'Thanks for helping me get to know you better!',
        'memory': AIMemorySerializer(ai_memory).data
    })


def compress_context(context_str: str) -> str:
    """
    Compress old context using Claude to maintain key information within token limits.
    """
    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        
        prompt = f"""Summarize this conversation history into key points about the user's habits, preferences, and patterns. Keep it under 500 words.

History:
{context_str}

Provide a concise summary focusing on:
- Work patterns and habits
- Time management tendencies
- Task completion patterns
- Communication preferences"""
        
        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        
        return message.content[0].text
    
    except Exception as e:
        print(f"[COMPRESS CONTEXT ERROR] {str(e)}")
        # Fallback: just truncate
        return context_str[-2000:]


def generate_ai_summary(user, ai_memory) -> str:
    """
    Generate a motivational, personalized message based on today's tasks and user preferences.
    """
    try:
        from datetime import date
        
        # Get today's date
        today = date.today()
        
        # Get today's tasks (scheduled for today or unscheduled active tasks)
        todays_tasks_query = Task.objects.filter(
            user=user,
            status__in=['pending', 'in_progress']
        ).filter(
            models.Q(scheduled_date=today) | models.Q(scheduled_date__isnull=True)
        )
        
        # Get high priority tasks count BEFORE slicing
        high_priority = todays_tasks_query.filter(priority='high').count()
        
        # Now slice for task list (must be done AFTER filtering)
        todays_tasks = todays_tasks_query[:5]
        
        completed_today = Task.objects.filter(
            user=user,
            status='done',
            completed_at__date=today
        ).count()
        
        # Get user preferences from onboarding
        onboarding_info = ai_memory.onboarding_data if ai_memory.onboarding_data else {}
        work_style = onboarding_info.get('work_style', '')
        biggest_challenge = onboarding_info.get('biggest_challenge', '')
        
        # Build task list for context
        task_titles = [t.title for t in todays_tasks]
        task_list_str = ", ".join(task_titles[:3]) if task_titles else "No tasks yet"
        
        # Build context for Claude
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        
        prompt = f"""Generate a SHORT motivational message (1-2 sentences max, under 50 words) for this user starting their day.

Today's context:
- Tasks on deck: {task_list_str}
- High priority items: {high_priority}
- Completed today: {completed_today}
- Work style: {work_style[:50] if work_style else 'Unknown'}
- Challenge: {biggest_challenge[:50] if biggest_challenge else 'Unknown'}

Be encouraging and reference their tasks or preferences if relevant. Keep it casual, friendly, and motivating. Use only ASCII characters. Start with something upbeat."""
        
        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=128,
            messages=[{"role": "user", "content": prompt}]
        )
        
        summary = message.content[0].text.strip()
        print(f"[GENERATE AI SUMMARY] Generated summary for user {user.username}: {summary}")
        return summary
    
    except Exception as e:
        print(f"[GENERATE AI SUMMARY ERROR] {str(e)}")
        import traceback
        print(traceback.format_exc())
        # Fallback - provide motivational message
        from datetime import date
        today = date.today()
        completed_today = Task.objects.filter(user=user, status='done', completed_at__date=today).count()
        pending_today = Task.objects.filter(user=user, status__in=['pending', 'in_progress']).count()
        
        if completed_today > 0:
            return f"Great start! You've completed {completed_today} task{'s' if completed_today > 1 else ''} today. Keep up the momentum!"
        elif pending_today > 0:
            return f"You've got {pending_today} task{'s' if pending_today > 1 else ''} ready to tackle. Let's make today productive!"
        return "Ready to make today count? Add your first task and let's get started!"


# ============================================================================
# UTILITY FUNCTION (Stubbed for MVP)
# ============================================================================

def send_smart_nudge(user, task):
    """
    Placeholder for push notifications
    In production, this would send a notification to the user
    """
    print(f"[SMART NUDGE] Would send notification to {user.username} about task: {task.title}")
    # TODO: Implement with expo-notifications or similar
    pass