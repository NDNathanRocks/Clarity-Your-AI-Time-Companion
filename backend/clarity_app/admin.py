from django.contrib import admin
from .models import UserProfile, Task, TaskFeedback


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'has_google_calendar', 'created_at']
    search_fields = ['user__username', 'user__email']
    
    def has_google_calendar(self, obj):
        return bool(obj.google_access_token)
    has_google_calendar.boolean = True


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'user', 'status', 'estimated_duration_minutes', 'created_at']
    list_filter = ['status', 'created_at']
    search_fields = ['title', 'user__username']


@admin.register(TaskFeedback)
class TaskFeedbackAdmin(admin.ModelAdmin):
    list_display = ['task_title', 'user', 'user_feedback', 'estimated_duration', 'timestamp']
    list_filter = ['user_feedback', 'timestamp']
    search_fields = ['task_title', 'user__username']