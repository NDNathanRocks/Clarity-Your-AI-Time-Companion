"""
Database Reset Script for Clarity App

This script deletes all user data from the database while preserving
the database structure and admin/superuser accounts.

Usage:
    python reset_database.py

WARNING: This will permanently delete all tasks, calendar events, 
feedback, and AI memory data. Use with caution!
"""

import os
import sys
import django

# Setup Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'clarity_project.settings')
django.setup()

from django.contrib.auth.models import User
from clarity_app.models import Task, TaskFeedback, CalendarEvent, AIMemory, UserProfile


def reset_database():
    """
    Delete all user data while preserving user accounts.
    You can optionally delete all users except superusers.
    """
    
    print("\n" + "="*60)
    print("CLARITY DATABASE RESET SCRIPT")
    print("="*60)
    print("\nThis will delete ALL data from the database.")
    print("\nWhat would you like to delete?")
    print("1. Delete all tasks, events, and AI data (keep users)")
    print("2. Delete everything including regular users (keep superusers)")
    print("3. Delete EVERYTHING including superusers (complete reset)")
    print("4. Cancel")
    
    choice = input("\nEnter your choice (1-4): ").strip()
    
    if choice == '4':
        print("\n✓ Cancelled. No changes made.")
        return
    
    if choice not in ['1', '2', '3']:
        print("\n✗ Invalid choice. Exiting.")
        return
    
    # Confirm action
    confirm = input("\n⚠️  Are you SURE? Type 'DELETE' to confirm: ").strip()
    if confirm != 'DELETE':
        print("\n✓ Cancelled. No changes made.")
        return
    
    print("\n" + "-"*60)
    print("Starting deletion process...")
    print("-"*60 + "\n")
    
    try:
        # Delete all tasks (this will cascade to subtasks)
        task_count = Task.objects.all().count()
        Task.objects.all().delete()
        print(f"✓ Deleted {task_count} tasks")
        
        # Delete all task feedback
        feedback_count = TaskFeedback.objects.all().count()
        TaskFeedback.objects.all().delete()
        print(f"✓ Deleted {feedback_count} task feedbacks")
        
        # Delete all calendar events
        event_count = CalendarEvent.objects.all().count()
        CalendarEvent.objects.all().delete()
        print(f"✓ Deleted {event_count} calendar events")
        
        # Reset AI Memory (keep the records but clear data)
        memory_count = AIMemory.objects.all().count()
        for memory in AIMemory.objects.all():
            memory.work_patterns = {}
            memory.communication_style = ''
            memory.task_categories = {}
            memory.performance_metrics = {}
            memory.context_summary = ''
            memory.ai_summary = ''
            memory.ai_summary_updated = None
            memory.onboarding_completed = False
            memory.onboarding_data = {}
            memory.save()
        print(f"✓ Reset {memory_count} AI memory records")
        
        # Reset user profiles (clear Google tokens)
        profile_count = UserProfile.objects.all().count()
        for profile in UserProfile.objects.all():
            profile.google_access_token = None
            profile.google_refresh_token = None
            profile.google_token_expiry = None
            profile.save()
        print(f"✓ Reset {profile_count} user profiles")
        
        if choice in ['2', '3']:
            # Delete regular users (not superusers)
            if choice == '2':
                regular_users = User.objects.filter(is_superuser=False)
                user_count = regular_users.count()
                regular_users.delete()
                print(f"✓ Deleted {user_count} regular users (superusers preserved)")
            else:
                # Delete ALL users including superusers
                user_count = User.objects.all().count()
                User.objects.all().delete()
                print(f"✓ Deleted {user_count} users (including superusers)")
        else:
            print(f"✓ Preserved all {User.objects.count()} user accounts")
        
        print("\n" + "="*60)
        print("DATABASE RESET COMPLETE!")
        print("="*60)
        
        if choice == '1':
            print("\n✓ All task data deleted")
            print("✓ User accounts preserved")
            print("✓ Users can log in with existing credentials")
        elif choice == '2':
            print("\n✓ All task data deleted")
            print("✓ Regular users deleted")
            print("✓ Superuser accounts preserved")
        else:
            print("\n✓ Complete database reset")
            print("✓ All users deleted")
            print("⚠️  You'll need to create new user accounts")
        
        print("\n")
        
    except Exception as e:
        print(f"\n✗ Error during reset: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    reset_database()
