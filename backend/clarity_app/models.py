from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver


class UserProfile(models.Model):
    """Extends User model to store Google OAuth tokens"""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    google_access_token = models.TextField(blank=True, null=True)
    google_refresh_token = models.TextField(blank=True, null=True)
    google_token_expiry = models.DateTimeField(blank=True, null=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Profile for {self.user.username}"


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Automatically create a UserProfile when a User is created"""
    if created:
        UserProfile.objects.create(user=instance)


@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    """Save the UserProfile when the User is saved.

    Defensive: if a UserProfile doesn't exist (e.g. for users created before
    this signal was registered), create one instead of raising an exception.
    """
    try:
        instance.profile.save()
    except UserProfile.DoesNotExist:
        UserProfile.objects.create(user=instance)


class Task(models.Model):
    """User tasks with AI time estimates"""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('done', 'Done'),
        ('overdue', 'Overdue'),
    ]
    
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tasks')
    parent_task = models.ForeignKey('self', on_delete=models.CASCADE, related_name='subtasks', null=True, blank=True)
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    due_date = models.DateTimeField(blank=True, null=True)
    estimated_duration_minutes = models.IntegerField(default=0)
    ai_friendly_message = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='medium')
    location = models.CharField(max_length=500, blank=True, null=True)
    
    # Scheduling fields
    scheduled_date = models.DateField(blank=True, null=True)
    scheduled_time = models.TimeField(blank=True, null=True)
    calendar_event_id = models.CharField(max_length=100, blank=True, null=True)  # Link to CalendarEvent
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.title} ({self.user.username})"


class TaskFeedback(models.Model):
    """User feedback on task completion for AI learning"""
    FEEDBACK_CHOICES = [
        ('on_time', 'On Time'),
        ('little_late', 'A Little Late'),
        ('very_late', 'Very Late'),
        ('early', 'Finished Early'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='task_feedback')
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='feedback', null=True)
    task_title = models.CharField(max_length=500)  # Denormalized for easy AI prompting
    estimated_duration = models.IntegerField()  # In minutes
    user_feedback = models.CharField(max_length=20, choices=FEEDBACK_CHOICES)
    notes = models.TextField(blank=True)
    
    timestamp = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-timestamp']
    
    def __str__(self):
        return f"{self.task_title} - {self.user_feedback} ({self.user.username})"


class CalendarEvent(models.Model):
    """User calendar events (app-based, not from Google)"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='calendar_events')
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    location = models.CharField(max_length=500, blank=True)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    all_day = models.BooleanField(default=False)
    color = models.CharField(max_length=7, default='#6366f1')  # Hex color code
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['start_time']
    
    def __str__(self):
        return f"{self.title} ({self.user.username})"


class AIMemory(models.Model):
    """Stores AI context and learned patterns about the user for personalization"""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='ai_memory')
    
    # User work patterns and preferences
    work_patterns = models.JSONField(default=dict, blank=True)  # e.g., {"typical_work_hours": "9am-5pm", "preferred_break_time": 15}
    communication_style = models.TextField(blank=True)  # e.g., "Prefers concise responses, uses emojis"
    task_categories = models.JSONField(default=dict, blank=True)  # e.g., {"Math151": {"avg_time": 25, "accuracy": "early"}}
    performance_metrics = models.JSONField(default=dict, blank=True)  # e.g., {"velocity_factor": 0.8, "typical_delay": "+20%"}
    
    # Conversation context (summarized periodically)
    context_summary = models.TextField(blank=True)  # Compressed history of interactions
    last_context_update = models.DateTimeField(auto_now=True)
    
    # AI-generated insights summary
    ai_summary = models.TextField(blank=True)  # Personalized summary of user's productivity patterns
    ai_summary_updated = models.DateTimeField(null=True, blank=True)  # Last time summary was regenerated
    
    # Onboarding
    onboarding_completed = models.BooleanField(default=False)
    onboarding_data = models.JSONField(default=dict, blank=True)  # Responses from initial questions
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name_plural = "AI Memories"
    
    def __str__(self):
        return f"AI Memory for {self.user.username}"


@receiver(post_save, sender=User)
def create_ai_memory(sender, instance, created, **kwargs):
    """Automatically create AIMemory when a User is created"""
    if created:
        AIMemory.objects.create(user=instance)


@receiver(post_save, sender=User)
def save_ai_memory(sender, instance, **kwargs):
    """Save the AIMemory when the User is saved (defensive)"""
    try:
        instance.ai_memory.save()
    except AIMemory.DoesNotExist:
        AIMemory.objects.create(user=instance)