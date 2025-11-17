from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, Task, TaskFeedback, CalendarEvent, AIMemory


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']


class UserProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    has_google_calendar = serializers.SerializerMethodField()
    
    class Meta:
        model = UserProfile
        fields = ['id', 'user', 'has_google_calendar', 'created_at', 'updated_at']
    
    def get_has_google_calendar(self, obj):
        return bool(obj.google_access_token and obj.google_refresh_token)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name']
    
    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', '')
        )
        return user


class TaskSerializer(serializers.ModelSerializer):
    subtasks = serializers.SerializerMethodField()
    
    class Meta:
        model = Task
        fields = [
            'id', 'parent_task', 'title', 'description', 'due_date', 
            'estimated_duration_minutes', 'ai_friendly_message',
            'status', 'priority', 'location', 'subtasks', 'created_at', 'updated_at', 'completed_at',
            'scheduled_date', 'scheduled_time', 'calendar_event_id'
        ]
        read_only_fields = ['created_at', 'updated_at', 'completed_at']
    
    def get_subtasks(self, obj):
        # Return subtasks if this is a parent task
        if obj.subtasks.exists():
            return TaskSerializer(obj.subtasks.all(), many=True).data
        return []


class TaskFeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskFeedback
        fields = [
            'id', 'task', 'task_title', 'estimated_duration',
            'user_feedback', 'notes', 'timestamp'
        ]
        read_only_fields = ['timestamp']


class CalendarEventSerializer(serializers.ModelSerializer):
    start_time = serializers.DateTimeField(format='%Y-%m-%dT%H:%M')
    end_time = serializers.DateTimeField(format='%Y-%m-%dT%H:%M')
    
    class Meta:
        model = CalendarEvent
        fields = [
            'id', 'title', 'description', 'location',
            'start_time', 'end_time', 'all_day', 'color',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']


class AIMemorySerializer(serializers.ModelSerializer):
    class Meta:
        model = AIMemory
        fields = [
            'id', 'work_patterns', 'communication_style', 'task_categories',
            'performance_metrics', 'context_summary', 'onboarding_completed',
            'onboarding_data', 'ai_summary', 'ai_summary_updated', 
            'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at', 'ai_summary', 'ai_summary_updated']