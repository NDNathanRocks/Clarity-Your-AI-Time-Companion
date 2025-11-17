from django.urls import path
from . import views

urlpatterns = [
    # Authentication
    path('register/', views.register_view, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('profile/', views.profile_view, name='profile'),
    
    # Google Calendar
    path('calendar/connect/', views.google_calendar_connect, name='calendar_connect'),
    path('calendar/redirect/', views.google_calendar_redirect, name='calendar_redirect'),
    path('calendar/events/', views.google_calendar_events, name='calendar_events'),
    
    # Calendar Events (App-based)
    path('events/', views.calendar_event_list, name='calendar_event_list'),
    path('events/create/', views.calendar_event_create, name='calendar_event_create'),
    path('events/<int:event_id>/delete/', views.calendar_event_delete, name='calendar_event_delete'),
    path('events/<int:event_id>/', views.calendar_event_update, name='calendar_event_update'),
    
    # Tasks
    path('tasks/', views.task_list, name='task_list'),
    path('tasks/estimate/', views.task_estimate, name='task_estimate'),
    path('tasks/breakdown/', views.task_breakdown_analyze, name='task_breakdown'),
    path('tasks/create/', views.task_create_with_subtasks, name='task_create'),
    path('tasks/feedback/', views.task_feedback_create, name='task_feedback'),
    path('tasks/find-slots/', views.task_find_slots, name='task_find_slots'),
    path('tasks/schedule/', views.task_schedule, name='task_schedule'),
    path('tasks/reschedule/', views.task_reschedule, name='task_reschedule'),
    path('tasks/unschedule/', views.task_unschedule, name='task_unschedule'),
    path('tasks/<int:task_id>/delete/', views.task_delete, name='task_delete'),
    path('tasks/<int:task_id>/', views.task_update, name='task_update'),
    
    # AI Memory & Personalization
    path('ai/memory/', views.ai_memory_view, name='ai_memory'),
    path('ai/onboarding/', views.ai_onboarding, name='ai_onboarding'),
    
    # AI Chat
    path('chat/', views.ai_chat, name='ai_chat'),
]