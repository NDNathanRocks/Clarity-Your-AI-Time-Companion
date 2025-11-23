import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { API_BASE_URL } from '../config';

// Pastel color scheme for priorities
const PRIORITY_COLORS = {
  low: '#B8E6B8',     // Pastel green
  medium: '#FFF4B8',  // Pastel yellow
  high: '#FFB8B8'     // Pastel red/pink
};

interface AddTaskModalProps {
  visible: boolean;
  onClose: () => void;
  onTaskCreated: () => void;
}

interface Subtask {
  title: string;
  estimated_duration_minutes: number;
  description?: string;
  isBreak?: boolean;
}

export default function AddTaskModal({ visible, onClose, onTaskCreated }: AddTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [location, setLocation] = useState('');
  const [duration, setDuration] = useState(60); // minutes, default 1 hour
  
  // Initialize date to today, time to 9:00 AM
  const getDefaultTime = () => {
    const time = new Date();
    time.setHours(9, 0, 0, 0); // 9:00 AM
    return time;
  };
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState(getDefaultTime());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
  
  // Breakdown flow
  const [breakdownData, setBreakdownData] = useState<any>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [showBreakdownConfirm, setShowBreakdownConfirm] = useState(false);

  useEffect(() => {
    checkLocationPermission();
  }, []);

  const checkLocationPermission = async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationPermissionGranted(status === 'granted');
  };

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationPermissionGranted(true);
      getCurrentLocation();
    } else {
      Alert.alert('Permission Denied', 'Location permission is needed to auto-fill your current location.');
    }
  };

  const getCurrentLocation = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({});
      const address = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });
      
      if (address.length > 0) {
        const addr = address[0];
        const locationStr = `${addr.street || ''}, ${addr.city || ''}, ${addr.region || ''}`.trim();
        setLocation(locationStr);
      }
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Could not get current location');
    }
  };

  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins}min`;
    } else if (mins === 0) {
      return `${hours}hr`;
    } else {
      return `${hours}hr ${mins}min`;
    }
  };

  const formatDateForDisplay = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    return `${day} ${month}`;
  };

  const formatTimeForDisplay = (date: Date): string => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const roundToNearest15 = (date: Date): Date => {
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;
    const newDate = new Date(date);
    newDate.setMinutes(roundedMinutes);
    newDate.setSeconds(0);
    newDate.setMilliseconds(0);
    return newDate;
  };

  // Calculate total duration from subtasks
  const calculateTotalDuration = (subtaskList: Subtask[]) => {
    if (subtaskList.length === 0) return duration; // Keep current duration if no subtasks
    return subtaskList.reduce((total, st) => total + st.estimated_duration_minutes, 0);
  };

  const handleAddSubtask = () => {
    const updated = [...subtasks, { title: '', estimated_duration_minutes: 30 }];
    setSubtasks(updated);
    setDuration(calculateTotalDuration(updated));
  };

  const handleAddBreak = () => {
    const updated = [...subtasks, { title: 'Break', estimated_duration_minutes: 15, description: 'Take a break', isBreak: true }];
    setSubtasks(updated);
    setDuration(calculateTotalDuration(updated));
  };

  const handleUpdateSubtask = (index: number, field: string, value: any) => {
    const updated = [...subtasks];
    updated[index] = { ...updated[index], [field]: value };
    setSubtasks(updated);
    setDuration(calculateTotalDuration(updated));
  };

  const handleDeleteSubtask = (index: number) => {
    const updated = subtasks.filter((_, i) => i !== index);
    setSubtasks(updated);
    setDuration(calculateTotalDuration(updated));
  };

  // Trigger breakdown analysis
  const checkForBreakdown = async () => {
    if (!title.trim()) return false;

    try {
      const token = await AsyncStorage.getItem('authToken');

      const response = await fetch(`${API_BASE_URL}/tasks/breakdown/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
        }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      
      if (data.should_break_down && data.suggested_subtasks && data.suggested_subtasks.length > 0) {
        setBreakdownData(data);
        const suggestedSubtasks = data.suggested_subtasks.map((st: any) => ({
          title: st.title,
          estimated_duration_minutes: st.estimated_duration_minutes || st.estimated_minutes || 30,
          description: st.description || '',
        }));
        setSubtasks(suggestedSubtasks);
        setDuration(calculateTotalDuration(suggestedSubtasks));
        setShowBreakdownConfirm(true);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Breakdown check error:', error);
      return false;
    }
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a task title');
      return;
    }

    setLoading(true);

    // Check for breakdown if not already shown
    if (!showBreakdownConfirm && subtasks.length === 0) {
      const shouldBreakdown = await checkForBreakdown();
      if (shouldBreakdown) {
        setLoading(false);
        return; // Wait for user confirmation
      }
    }

    await createTask();
  };

  const createTask = async () => {
    try {
      // Get auth token
      const token = await AsyncStorage.getItem('authToken');
      
      // Format date and time
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const hours = String(selectedTime.getHours()).padStart(2, '0');
      const minutes = String(selectedTime.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      
      const taskData: any = {
        title: title.trim(),
        description: description.trim(),
        estimated_duration_minutes: subtasks.length > 0 
          ? subtasks.reduce((sum, st) => sum + st.estimated_duration_minutes, 0)
          : duration,
        priority,
        location: location.trim() || null,
        ai_message: breakdownData?.witty_message || '',
        subtasks: subtasks.map(st => ({
          title: st.title,
          estimated_duration_minutes: st.estimated_duration_minutes,
          description: st.description || '',
        })),
      };

      // Only add scheduling if user chose to schedule
      if (isScheduled) {
        taskData.scheduled_date = dateStr;
        taskData.scheduled_time = timeStr;
        console.log('📅 Scheduling task:', { dateStr, timeStr, selectedDate, selectedTime });
      }

      console.log('📤 Creating task with data:', taskData);

      const response = await fetch(`${API_BASE_URL}/tasks/create/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify(taskData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create task');
      }

      // Reset form
      setTitle('');
      setDescription('');
      setPriority('medium');
      setLocation('');
      setDuration(60);
      setSelectedDate(new Date());
      setSelectedTime(getDefaultTime());
      setSubtasks([]);
      setBreakdownData(null);
      setShowBreakdownConfirm(false);
      setIsScheduled(false);

      if (isScheduled) {
        Alert.alert('✅ Success', `Task scheduled for ${formatDateForDisplay(selectedDate)} at ${formatTimeForDisplay(selectedTime)}!\n\nNavigate to that date on the calendar to view it.`);
      } else {
        Alert.alert('✅ Success', 'Task created successfully!');
      }
      onTaskCreated();
      onClose();
    } catch (error: any) {
      console.error('Error creating task:', error);
      Alert.alert('Error', error.message || 'Failed to create task. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.overlay}>
          <View style={styles.modalContainer}>
            <ScrollView 
              style={styles.scrollView} 
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
            <Text style={styles.title}>Add New Task</Text>

            {/* Task Title */}
            <Text style={styles.label}>Task Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter task title"
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />

            {/* Description */}
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Add details (optional)"
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            {/* Priority */}
            <Text style={styles.label}>Priority *</Text>
            <View style={styles.priorityContainer}>
              {(['low', 'medium', 'high'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityButton,
                    { backgroundColor: PRIORITY_COLORS[p] },
                    priority === p && styles.priorityButtonSelected
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={[
                    styles.priorityText,
                    priority === p && styles.priorityTextSelected
                  ]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Duration Slider */}
            <Text style={styles.label}>Duration: {formatDuration(duration)}</Text>
            <Slider
              style={styles.slider}
              minimumValue={5}
              maximumValue={720}
              step={5}
              value={duration}
              onValueChange={setDuration}
              minimumTrackTintColor="#6366f1"
              maximumTrackTintColor="#d1d5db"
              thumbTintColor="#6366f1"
            />
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>5min</Text>
              <Text style={styles.sliderLabel}>12hr</Text>
            </View>

            {/* Clarity Breakdown Button */}
            {!showBreakdownConfirm && subtasks.length === 0 && (
              <TouchableOpacity
                style={{
                  backgroundColor: '#eff6ff',
                  borderWidth: 2,
                  borderColor: '#6366f1',
                  borderStyle: 'dashed',
                  borderRadius: 12,
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  marginTop: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={async () => {
                  if (!title.trim()) {
                    Alert.alert('Missing Title', 'Please enter a task title first');
                    return;
                  }
                  setLoading(true);
                  await checkForBreakdown();
                  setLoading(false);
                }}
              >
                <Text style={{ fontSize: 20, marginRight: 8 }}>✨</Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#6366f1' }}>
                  Clarity Breakdown
                </Text>
              </TouchableOpacity>
            )}

            {/* Location */}
            <Text style={styles.label}>Location (Optional)</Text>
            <View style={styles.locationContainer}>
              <TextInput
                style={[styles.input, styles.locationInput]}
                placeholder="Add location"
                placeholderTextColor="#9ca3af"
                value={location}
                onChangeText={setLocation}
                maxLength={500}
              />
              {locationPermissionGranted ? (
                <TouchableOpacity
                  style={styles.locationButton}
                  onPress={getCurrentLocation}
                >
                  <Text style={styles.locationButtonText}>📍 Current</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.locationButton}
                  onPress={requestLocationPermission}
                >
                  <Text style={styles.locationButtonText}>📍 Enable</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Scheduled Date & Time */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <Text style={styles.label}>Schedule Task?</Text>
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: isScheduled ? '#6366f1' : '#e5e7eb',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                }}
                onPress={() => {
                  const newScheduledState = !isScheduled;
                  setIsScheduled(newScheduledState);
                  // Reset to defaults when enabling scheduling
                  if (newScheduledState) {
                    setSelectedDate(new Date());
                    setSelectedTime(getDefaultTime());
                  }
                }}
              >
                <Text style={{ color: isScheduled ? '#fff' : '#6b7280', fontWeight: '600', fontSize: 14 }}>
                  {isScheduled ? '✓ Scheduled' : 'Unscheduled'}
                </Text>
              </TouchableOpacity>
            </View>

            {isScheduled && (
              <>
                <View style={styles.scheduleContainer}>
                  {Platform.OS === 'web' ? (
                    <>
                      {/* Native HTML date/time inputs for web */}
                      <input
                        type="date"
                        value={selectedDate.toISOString().split('T')[0]}
                        onChange={(e) => {
                          const newDate = new Date(e.target.value + 'T00:00:00');
                          setSelectedDate(newDate);
                        }}
                        style={{
                          flex: 1,
                          padding: '12px',
                          fontSize: '16px',
                          borderRadius: '8px',
                          border: '1px solid #d1d5db',
                          marginRight: '8px',
                          cursor: 'pointer',
                        }}
                      />
                      <input
                        type="time"
                        value={(() => {
                          const roundedTime = roundToNearest15(selectedTime);
                          return `${String(roundedTime.getHours()).padStart(2, '0')}:${String(roundedTime.getMinutes()).padStart(2, '0')}`;
                        })()}
                        onChange={(e) => {
                          const [hours, minutes] = e.target.value.split(':');
                          const newTime = new Date();
                          newTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                          setSelectedTime(roundToNearest15(newTime));
                        }}
                        step="900"
                        style={{
                          flex: 1,
                          padding: '12px',
                          fontSize: '16px',
                          borderRadius: '8px',
                          border: '1px solid #d1d5db',
                          cursor: 'pointer',
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.input, styles.scheduleInput, { justifyContent: 'center' }]}
                        onPress={() => {
                          setShowTimePicker(false);
                          setShowDatePicker(true);
                        }}
                      >
                        <Text style={{ fontSize: 16, color: '#111827' }}>{formatDateForDisplay(selectedDate)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.input, styles.scheduleInput, { justifyContent: 'center' }]}
                        onPress={() => {
                          setShowDatePicker(false);
                          setShowTimePicker(true);
                        }}
                      >
                        <Text style={{ fontSize: 16, color: '#111827' }}>{formatTimeForDisplay(selectedTime)}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                {/* Date Picker Wheel - Only for iOS/Android */}
                {showDatePicker && Platform.OS !== 'web' && (
                  <View style={{ backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, marginTop: 12, marginBottom: 12 }}>
                    <DateTimePicker
                      value={selectedDate}
                      mode="date"
                      display={Platform.OS === 'web' ? 'default' : (Platform.OS === 'ios' ? 'spinner' : 'default')}
                      textColor="#111827"
                      onChange={(event, date) => {
                        if (date) {
                          setSelectedDate(date);
                        }
                        // Auto-close on web/Android after selection
                        if (Platform.OS !== 'ios' && event.type === 'set') {
                          setShowDatePicker(false);
                        }
                      }}
                      style={{ height: Platform.OS === 'ios' ? 150 : undefined, width: '100%' }}
                    />
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity
                        style={{ backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 10, marginTop: 8 }}
                        onPress={() => setShowDatePicker(false)}
                      >
                        <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>Done</Text>
                      </TouchableOpacity>
                    )}
                    {Platform.OS === 'web' && (
                      <TouchableOpacity
                        style={{ backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 10, marginTop: 12 }}
                        onPress={() => setShowDatePicker(false)}
                      >
                        <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>Confirm</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Time Picker Wheel - Only for iOS/Android */}
                {showTimePicker && Platform.OS !== 'web' && (
                  <View style={{ backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, marginTop: 12, marginBottom: 12 }}>
                    <DateTimePicker
                      value={selectedTime}
                      mode="time"
                      display={Platform.OS === 'web' ? 'default' : (Platform.OS === 'ios' ? 'spinner' : 'default')}
                      textColor="#111827"
                      minuteInterval={15}
                      onChange={(event, time) => {
                        if (time) {
                          const roundedTime = roundToNearest15(time);
                          setSelectedTime(roundedTime);
                        }
                        // Auto-close on web/Android after selection
                        if (Platform.OS !== 'ios' && event.type === 'set') {
                          setShowTimePicker(false);
                        }
                      }}
                      style={{ height: Platform.OS === 'ios' ? 150 : undefined, width: '100%' }}
                    />
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity
                        style={{ backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 10, marginTop: 8 }}
                        onPress={() => setShowTimePicker(false)}
                      >
                        <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>Done</Text>
                      </TouchableOpacity>
                    )}
                    {Platform.OS === 'web' && (
                      <TouchableOpacity
                        style={{ backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 10, marginTop: 12 }}
                        onPress={() => setShowTimePicker(false)}
                      >
                        <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>Confirm</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </>
            )}

            {/* Breakdown Confirmation */}
            {showBreakdownConfirm && breakdownData && (
              <View style={{ marginTop: 20, padding: 16, backgroundColor: '#eff6ff', borderRadius: 12, borderWidth: 1, borderColor: '#bfdbfe' }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#1e40af', marginBottom: 8 }}>
                  ✨ Clarity Suggests Breaking This Down
                </Text>
                <Text style={{ fontSize: 14, color: '#3b82f6', marginBottom: 12 }}>
                  {breakdownData.witty_message}
                </Text>
                <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                  {breakdownData.reasoning}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#6366f1', borderRadius: 6, paddingVertical: 8 }}
                    onPress={() => {
                      setShowBreakdownConfirm(false);
                      // Keep subtasks, continue with breakdown
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                      ✓ Use Breakdown
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#f3f4f6', borderRadius: 6, paddingVertical: 8, borderWidth: 1, borderColor: '#d1d5db' }}
                    onPress={() => {
                      setShowBreakdownConfirm(false);
                      setSubtasks([]);
                      setBreakdownData(null);
                    }}
                  >
                    <Text style={{ color: '#374151', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                      × Keep as Single Task
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Subtasks Section (only show if breakdown accepted or manually added) */}
            {subtasks.length > 0 && (
              <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={styles.label}>Subtasks ({subtasks.length})</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={{ backgroundColor: '#10b981', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
                      onPress={handleAddBreak}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>+ Break</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ backgroundColor: '#6366f1', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
                      onPress={handleAddSubtask}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>+ Subtask</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {subtasks.map((subtask, index) => (
                  <View key={index} style={{ backgroundColor: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#6b7280' }}>
                        {subtask.isBreak ? '☕ Break' : `Subtask ${index + 1}`}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleDeleteSubtask(index)}
                        style={{ padding: 4 }}
                      >
                        <Text style={{ fontSize: 18, color: '#ef4444' }}>×</Text>
                      </TouchableOpacity>
                    </View>

                  <TextInput
                    style={[styles.input, { marginBottom: 8 }]}
                    placeholder={subtask.isBreak ? "Break description" : "Subtask name"}
                    placeholderTextColor="#9ca3af"
                    value={subtask.title}
                      onChangeText={(text) => handleUpdateSubtask(index, 'title', text)}
                      maxLength={100}
                    />

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 13, color: '#6b7280', minWidth: 60 }}>Duration:</Text>
                      <View style={{ flex: 1 }}>
                        <Slider
                          style={{ height: 30 }}
                          minimumValue={5}
                          maximumValue={180}
                          step={5}
                          value={subtask.estimated_duration_minutes}
                          onValueChange={(value) => handleUpdateSubtask(index, 'estimated_duration_minutes', value)}
                          minimumTrackTintColor="#6366f1"
                          maximumTrackTintColor="#d1d5db"
                          thumbTintColor="#6366f1"
                        />
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827', minWidth: 60, textAlign: 'right' }}>
                        {formatDuration(subtask.estimated_duration_minutes)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={onClose}
                disabled={loading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.createButton]}
                onPress={handleCreate}
                disabled={loading}
              >
                <Text style={styles.createButtonText}>
                  {loading ? 'Creating...' : 'Create Task'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  scrollView: {
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#1f2937',
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9fafb',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  priorityContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  priorityButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  priorityButtonSelected: {
    borderColor: '#6366f1',
    borderWidth: 3,
  },
  priorityText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  priorityTextSelected: {
    color: '#1f2937',
    fontWeight: 'bold',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -8,
  },
  sliderLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  locationContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  locationInput: {
    flex: 1,
  },
  locationButton: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  locationButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  scheduleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  scheduleInput: {
    flex: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 24,
    marginBottom: 8,
  },
  button: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  cancelButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  createButton: {
    backgroundColor: '#6366f1',
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
