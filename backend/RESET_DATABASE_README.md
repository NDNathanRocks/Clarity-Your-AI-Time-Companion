# Database Reset Script

## Overview
The `reset_database.py` script allows you to clear all user data from the Clarity database while preserving the database structure.

## Usage

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Activate the virtual environment:**
   ```bash
   # Windows
   .\venv\Scripts\Activate.ps1
   
   # Mac/Linux
   source venv/bin/activate
   ```

3. **Run the reset script:**
   ```bash
   python reset_database.py
   ```

## Options

The script provides three reset options:

### Option 1: Delete Data Only (Recommended)
- ✅ Deletes all tasks, calendar events, and feedback
- ✅ Resets AI memory (clears learning data)
- ✅ Clears Google Calendar connections
- ✅ **Preserves all user accounts**
- Users can log in immediately with existing credentials

### Option 2: Delete Data + Regular Users
- ✅ Deletes all tasks, calendar events, and feedback
- ✅ Resets AI memory
- ✅ **Deletes all regular user accounts**
- ✅ **Preserves superuser/admin accounts**
- Only admins can log in after reset

### Option 3: Complete Reset
- ⚠️ **Deletes EVERYTHING**
- Removes all users including superusers
- Complete fresh start
- You'll need to create new accounts

## Safety Features

- **Confirmation Required**: You must type `DELETE` to confirm
- **Descriptive Output**: Shows exactly what was deleted
- **Error Handling**: Catches and reports any errors
- **No Database Structure Changes**: Only deletes data, not tables

## Example Output

```
============================================================
CLARITY DATABASE RESET SCRIPT
============================================================

This will delete ALL data from the database.

What would you like to delete?
1. Delete all tasks, events, and AI data (keep users)
2. Delete everything including regular users (keep superusers)
3. Delete EVERYTHING including superusers (complete reset)
4. Cancel

Enter your choice (1-4): 1

⚠️  Are you SURE? Type 'DELETE' to confirm: DELETE

------------------------------------------------------------
Starting deletion process...
------------------------------------------------------------

✓ Deleted 45 tasks
✓ Deleted 12 task feedbacks
✓ Deleted 23 calendar events
✓ Reset 3 AI memory records
✓ Reset 3 user profiles
✓ Preserved all 3 user accounts

============================================================
DATABASE RESET COMPLETE!
============================================================

✓ All task data deleted
✓ User accounts preserved
✓ Users can log in with existing credentials
```

## When to Use

- **Testing**: Clear data between test runs
- **Demos**: Start fresh for demonstrations
- **Development**: Reset after making significant changes
- **Data Issues**: Fix corrupted or inconsistent data

## Warning

⚠️ **This action is PERMANENT and cannot be undone!**

Make sure you have backups if you need to preserve any data.

## Troubleshooting

**Django not found error:**
```bash
# Make sure you're in the backend directory and virtual environment is activated
cd backend
.\venv\Scripts\Activate.ps1  # Windows
python reset_database.py
```

**Import errors:**
- Ensure you're running from the backend directory
- Verify the virtual environment is activated
- Check that Django is installed: `pip list | grep Django`
