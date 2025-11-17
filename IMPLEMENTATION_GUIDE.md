# Clarity App - Task Enhancement Implementation Guide

## Overview
This guide covers the implementation of new task features including priority, location, improved UI, and enhanced AI integration.

## Backend Changes (✅ COMPLETED)

### 1. Database Model Updates
**File:** `backend/clarity_app/models.py`
- ✅ Added `priority` field with choices: `low`, `medium` (default), `high`
- ✅ Added `location` field (optional, max 500 chars)

**Action Required:**
```bash
cd backend
python manage.py makemigrations
python manage.py migrate
```

### 2. Serializer Updates
**File:** `backend/clarity_app/serializers.py`
- ✅ Added `priority` and `location` to TaskSerializer fields

### 3. API Updates
**File:** `backend/clarity_app/views.py`
- ✅ Updated `task_delete` to delete associated calendar events
- ✅ Updated AI chat `create_task` tool to include priority and location
- ✅ Updated `create_task_with_breakdown` to include priority and location

---

## Frontend Changes (🚧 TO BE IMPLEMENTED)

### Priority Color Scheme (Pastel Colors)
```javascript
const PRIORITY_COLORS = {
  low: '#B8E6B8',     // Pastel green
  medium: '#FFF4B8',  // Pastel yellow
  high: '#FFB8B8'     // Pastel red/pink
};
```

### 1. Add Task Modal Component
**New Component:** `frontend/app/components/AddTaskModal.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';

interface AddTaskModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (taskData: TaskData) => void;
}

interface TaskData {
  title: string;
  description: string;
  estimated_duration_minutes: number;
  priority: 'low' | 'medium' | 'high';
  location: string;
  scheduled_date?: string;
  scheduled_time?: string;
}

export const AddTaskModal: React.FC<AddTaskModalProps> = ({
  visible,
  onClose,
  onSubmit,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(30); // Default 30 minutes
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);

  useEffect(() => {
    if (useCurrentLocation && visible) {
      getCurrentLocation();
    }
  }, [useCurrentLocation, visible]);

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access location was denied');
        setUseCurrentLocation(false);
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
      const address = await Location.reverseGeocodeAsync({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });

      if (address[0]) {
        const locationString = `${address[0].street || ''}, ${address[0].city || ''}`.trim();
        setLocation(locationString);
      }
    } catch (error) {
      console.error('Error getting location:', error);
      setUseCurrentLocation(false);
    }
  };

  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}min`;
    if (mins === 0) return `${hours}hr`;
    return `${hours}hr ${mins}min`;
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      alert('Please enter a task title');
      return;
    }

    const taskData: TaskData = {
      title: title.trim(),
      description: description.trim(),
      estimated_duration_minutes: duration,
      priority,
      location: location.trim(),
    };

    if (date) taskData.scheduled_date = date;
    if (time) taskData.scheduled_time = time;

    onSubmit(taskData);
    
    // Reset form
    setTitle('');
    setDescription('');
    setDuration(30);
    setPriority('medium');
    setLocation('');
    setDate('');
    setTime('');
    setUseCurrentLocation(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Add New Task</Text>

            {/* Title Input */}
            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="Task title..."
              value={title}
              onChangeText={setTitle}
            />

            {/* Description Input */}
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Add details..."
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />

            {/* Priority Selector */}
            <Text style={styles.label}>Priority *</Text>
            <View style={styles.priorityContainer}>
              {(['low', 'medium', 'high'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityButton,
                    { backgroundColor: priority === p ? PRIORITY_COLORS[p] : '#f0f0f0' },
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={styles.priorityText}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Duration Slider */}
            <Text style={styles.label}>
              Duration: {formatDuration(duration)}
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={5}
              maximumValue={720} // 12 hours
              step={5}
              value={duration}
              onValueChange={setDuration}
              minimumTrackTintColor="#6366f1"
              maximumTrackTintColor="#d1d5db"
            />
            <View style={styles.durationLabels}>
              <Text style={styles.durationLabel}>5min</Text>
              <Text style={styles.durationLabel}>12hr</Text>
            </View>

            {/* Location */}
            <Text style={styles.label}>Location (optional)</Text>
            <View style={styles.locationRow}>
              <TextInput
                style={[styles.input, styles.locationInput]}
                placeholder="Enter location..."
                value={location}
                onChangeText={setLocation}
              />
              <TouchableOpacity
                style={styles.locationButton}
                onPress={() => setUseCurrentLocation(!useCurrentLocation)}
              >
                <Text style={styles.locationButtonText}>
                  {useCurrentLocation ? '📍' : '📌'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Date & Time (Optional) */}
            <Text style={styles.label}>Schedule (optional)</Text>
            <View style={styles.dateTimeRow}>
              <TextInput
                style={[styles.input, styles.dateInput]}
                placeholder="YYYY-MM-DD"
                value={date}
                onChangeText={setDate}
              />
              <TextInput
                style={[styles.input, styles.timeInput]}
                placeholder="HH:MM"
                value={time}
                onChangeText={setTime}
              />
            </View>

            {/* Buttons */}
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
                <Text style={styles.submitButtonText}>Create Task</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const PRIORITY_COLORS = {
  low: '#B8E6B8',
  medium: '#FFF4B8',
  high: '#FFB8B8',
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 15,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  priorityContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  priorityButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  priorityText: {
    fontSize: 16,
    fontWeight: '600',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  durationLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -5,
  },
  durationLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationInput: {
    flex: 1,
    marginRight: 8,
  },
  locationButton: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationButtonText: {
    fontSize: 24,
  },
  dateTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateInput: {
    flex: 1,
    marginRight: 8,
  },
  timeInput: {
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 25,
  },
  cancelButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    marginRight: 8,
  },
  cancelButtonText: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#4b5563',
  },
  submitButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#6366f1',
    marginLeft: 8,
  },
  submitButtonText: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});
```

### 2. Update Tasks Screen
**File:** `frontend/app/index.tsx` - TasksScreen component

**Changes needed:**
1. Add `+ Add Task` button at the top
2. Import and use `AddTaskModal`
3. Update task cards to show priority color border
4. Add location badge on task cards
5. Add "Edit with Clarity" button on each task
6. Remove seconds from time display

**Key additions:**
```typescript
// Add to TasksScreen component
const [showAddModal, setShowAddModal] = useState(false);

// Add button before task list
<TouchableOpacity
  style={styles.addButton}
  onPress={() => setShowAddModal(true)}
>
  <Text style={styles.addButtonText}>+ Add Task</Text>
</TouchableOpacity>

// Add modal
<AddTaskModal
  visible={showAddModal}
  onClose={() => setShowAddModal(false)}
  onSubmit={handleCreateTask}
/>

// Update handleCreateTask to include new fields
const handleCreateTask = async (taskData: TaskData) => {
  try {
    const response = await api.post('/tasks/create/', taskData);
    refreshTasks();
    Alert.alert('Success', 'Task created successfully!');
  } catch (error) {
    console.error('Error creating task:', error);
    Alert.alert('Error', 'Failed to create task');
  }
};

// Update task card to show priority with color
<View style={[styles.taskCard, { borderLeftWidth: 4, borderLeftColor: PRIORITY_COLORS[task.priority] }]}>
  {/* Task content */}
  {task.location && (
    <Text style={styles.taskLocation}>📍 {task.location}</Text>
  )}
  {task.scheduled_time && (
    <Text style={styles.taskTime}>
      {task.scheduled_time.substring(0, 5)} {/* Remove seconds */}
    </Text>
  )}
</View>

// Add "Edit with Clarity" button
<TouchableOpacity
  style={styles.editWithClarityButton}
  onPress={() => navigateToChat(task)}
>
  <Text style={styles.editWithClarityText}>✨ Edit with Clarity</Text>
</TouchableOpacity>

const navigateToChat = (task: Task) => {
  navigation.navigate('Chat', {
    initialMessage: `I want to edit my task "${task.title}"`
  });
};
```

### 3. Install Required Packages
```bash
cd frontend
npm install @react-native-community/slider
npm install expo-location
```

### 4. Update package.json
Add to `app.json`:
```json
{
  "expo": {
    "plugins": [
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow Clarity to use your location for task locations."
        }
      ]
    ]
  }
}
```

---

## Testing Checklist

### Backend
- [ ] Run migrations successfully
- [ ] Create task with priority via API
- [ ] Create task with location via API
- [ ] Delete task and verify calendar event deletion
- [ ] AI chat creates tasks with priority and location

### Frontend
- [ ] Add Task button appears
- [ ] Modal opens and closes correctly
- [ ] Duration slider works (5min - 12hr)
- [ ] Priority buttons change color
- [ ] Location permission requested once
- [ ] Current location fetched and displayed
- [ ] Task cards show priority color border
- [ ] Location displayed on task cards
- [ ] "Edit with Clarity" navigates to chat
- [ ] No seconds displayed in times
- [ ] Task deletion removes calendar event

---

## UI/UX Notes

### Priority Colors (Pastel)
- **Low:** `#B8E6B8` (soft green)
- **Medium:** `#FFF4B8` (soft yellow)
- **High:** `#FFB8B8` (soft pink/red)

### Typography
- Modal title: 24px bold
- Labels: 16px semi-bold
- Input text: 16px regular
- Button text: 16px semi-bold

### Spacing
- Padding: 20px (modal), 12px (inputs)
- Margins: 15px (between sections)
- Border radius: 8px (inputs/buttons), 20px (modal)

---

## Next Steps

1. **Run Backend Migrations**
   ```bash
   cd backend
   python manage.py makemigrations
   python manage.py migrate
   ```

2. **Install Frontend Dependencies**
   ```bash
   cd frontend
   npm install @react-native-community/slider expo-location
   ```

3. **Create AddTaskModal Component**
   - Copy the component code above into a new file

4. **Update index.tsx**
   - Add imports for AddTaskModal
   - Add state for modal visibility
   - Add "+ Add Task" button
   - Update task card rendering
   - Add "Edit with Clarity" button

5. **Test Everything**
   - Follow the testing checklist above

---

## Common Issues & Solutions

**Issue:** Location permission not working
**Solution:** Make sure you've added the expo-location plugin to app.json and rebuilt the app

**Issue:** Slider not showing
**Solution:** Install @react-native-community/slider and restart Metro bundler

**Issue:** Times still showing seconds
**Solution:** Use `.substring(0, 5)` or `.slice(0, 5)` on time strings

**Issue:** Priority colors not showing
**Solution:** Check that task.priority is one of: 'low', 'medium', 'high'

---

## File Structure
```
Clarity/
├── backend/
│   ├── clarity_app/
│   │   ├── models.py ✅ UPDATED
│   │   ├── serializers.py ✅ UPDATED
│   │   └── views.py ✅ UPDATED
│   └── manage.py
├── frontend/
│   ├── app/
│   │   ├── components/
│   │   │   └── AddTaskModal.tsx 🚧 TO CREATE
│   │   └── index.tsx 🚧 TO UPDATE
│   └── package.json 🚧 TO UPDATE
└── IMPLEMENTATION_GUIDE.md ✅ THIS FILE
```
