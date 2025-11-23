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

interface Subtask {
  id?: number;
  title: string;
  estimated_duration_minutes: number;
  description?: string;
  order?: number;
  isBreak?: boolean;
}

interface Task {
  id: number;
  title: string;
  description: string;
  estimated_duration_minutes: number;
  priority?: 'low' | 'medium' | 'high';
  location?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  subtasks?: Subtask[];
}

interface EditTaskModalProps {
  visible: boolean;
  task: Task | null;
  onClose: () => void;
  onTaskUpdated: () => void;
}

export default function EditTaskModal({ visible, task, onClose, onTaskUpdated }: EditTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [location, setLocation] = useState('');
  const [duration, setDuration] = useState(60);
  const [isScheduled, setIsScheduled] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);

  useEffect(() => {
    if (task && visible) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setLocation(task.location || '');
      setDuration(task.estimated_duration_minutes || 60);
      
      // Handle scheduling
      if (task.scheduled_date && task.scheduled_time) {
        setIsScheduled(true);
        const dateTime = new Date(`${task.scheduled_date}T${task.scheduled_time}`);
        setSelectedDate(dateTime);
        setSelectedTime(dateTime);
      } else {
        setIsScheduled(false);
        setSelectedDate(new Date());
        setSelectedTime(new Date());
      }
      
      setSubtasks(task.subtasks || []);
    }
  }, [task, visible]);

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

  const handleUpdateSubtask = (index: number, field: keyof Subtask, value: any) => {
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

  const handleMoveSubtaskUp = (index: number) => {
    if (index === 0) return;
    const updated = [...subtasks];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setSubtasks(updated);
  };

  const handleMoveSubtaskDown = (index: number) => {
    if (index === subtasks.length - 1) return;
    const updated = [...subtasks];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setSubtasks(updated);
  };

  const handleUpdate = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a task title');
      return;
    }

    if (!task) return;

    setLoading(true);

    try {
      const token = await AsyncStorage.getItem('authToken');

      // Format date and time if scheduled
      let dateStr = '';
      let timeStr = '';
      
      if (isScheduled) {
        const year = selectedDate.getFullYear();
        const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const day = String(selectedDate.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
        
        const hours = String(selectedTime.getHours()).padStart(2, '0');
        const minutes = String(selectedTime.getMinutes()).padStart(2, '0');
        timeStr = `${hours}:${minutes}`;
      }

      // Update main task
      const taskData: any = {
        title: title.trim(),
        description: description.trim(),
        estimated_duration_minutes: duration,
        priority,
        location: location.trim() || null,
      };

      if (isScheduled && dateStr && timeStr) {
        taskData.scheduled_date = dateStr;
        taskData.scheduled_time = timeStr;
      } else {
        taskData.scheduled_date = null;
        taskData.scheduled_time = null;
      }

      const response = await fetch(`${API_BASE_URL}/tasks/${task.id}/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify(taskData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update task');
      }

      // Delete removed subtasks
      const existingSubtaskIds = task.subtasks?.map(st => st.id).filter(id => id !== undefined) || [];
      const currentSubtaskIds = subtasks.map(st => st.id).filter(id => id !== undefined);
      const deletedIds = existingSubtaskIds.filter(id => !currentSubtaskIds.includes(id));

      for (const id of deletedIds) {
        await fetch(`${API_BASE_URL}/tasks/${id}/delete/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Token ${token}`,
          },
        });
      }

      // Update or create subtasks with proper parent_task relationship
      for (let i = 0; i < subtasks.length; i++) {
        const subtask = subtasks[i];
        
        if (subtask.id) {
          // Update existing subtask - use PUT to update all fields including order
          const subtaskData = {
            title: subtask.title,
            description: subtask.description || '',
            estimated_duration_minutes: subtask.estimated_duration_minutes,
            parent_task: task.id,
            order: i,
            status: 'pending', // Keep subtasks as pending
          };

          await fetch(`${API_BASE_URL}/tasks/${subtask.id}/`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Token ${token}`,
            },
            body: JSON.stringify(subtaskData),
          });
        } else {
          // Create new subtask - MUST include parent_task to link it properly
          const newSubtaskData = {
            title: subtask.title,
            description: subtask.description || '',
            estimated_duration_minutes: subtask.estimated_duration_minutes,
            ai_message: '',
            subtasks: [], // New subtasks don't have their own subtasks
            parent_task: task.id, // Critical: link to parent task
            order: i,
          };

          const createResponse = await fetch(`${API_BASE_URL}/tasks/create/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Token ${token}`,
            },
            body: JSON.stringify(newSubtaskData),
          });

          if (!createResponse.ok) {
            const errorData = await createResponse.json();
            console.error('Failed to create subtask:', errorData);
            throw new Error('Failed to create subtask: ' + (errorData.error || 'Unknown error'));
          }
        }
      }

      Alert.alert('Success', 'Task updated successfully!');
      onTaskUpdated();
      onClose();
    } catch (error: any) {
      console.error('Error updating task:', error);
      Alert.alert('Error', error.message || 'Failed to update task. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

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
            <Text style={styles.title}>Edit Task</Text>

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
                  <Text style={styles.locationButtonText}>📍</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.locationButton}
                  onPress={requestLocationPermission}
                >
                  <Text style={styles.locationButtonText}>📍</Text>
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
                  if (!newScheduledState) {
                    // Clear scheduling when disabled
                    setSelectedDate(new Date());
                    setSelectedTime(new Date());
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

                {showDatePicker && Platform.OS !== 'web' && (
                  <View style={{ backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, marginTop: 12, marginBottom: 12 }}>
                    <DateTimePicker
                      value={selectedDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      textColor="#111827"
                      onChange={(event, date) => {
                        if (date) {
                          setSelectedDate(date);
                        }
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
                  </View>
                )}

                {showTimePicker && Platform.OS !== 'web' && (
                  <View style={{ backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, marginTop: 12, marginBottom: 12 }}>
                    <DateTimePicker
                      value={selectedTime}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      textColor="#111827"
                      minuteInterval={15}
                      onChange={(event, time) => {
                        if (time) {
                          const roundedTime = roundToNearest15(time);
                          setSelectedTime(roundedTime);
                        }
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
                  </View>
                )}
              </>
            )}

            {/* Subtasks Section */}
            <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={styles.label}>Subtasks</Text>
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
                <View key={index} style={styles.subtaskCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    {/* Left side: Order controls */}
                    <View style={{ flexDirection: 'column', gap: 4, marginRight: 8 }}>
                      <TouchableOpacity
                        onPress={() => handleMoveSubtaskUp(index)}
                        disabled={index === 0}
                        style={{
                          backgroundColor: index === 0 ? '#e5e7eb' : '#6366f1',
                          borderRadius: 4,
                          padding: 4,
                          width: 28,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: index === 0 ? '#9ca3af' : '#fff', fontSize: 12, fontWeight: '600' }}>▲</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleMoveSubtaskDown(index)}
                        disabled={index === subtasks.length - 1}
                        style={{
                          backgroundColor: index === subtasks.length - 1 ? '#e5e7eb' : '#6366f1',
                          borderRadius: 4,
                          padding: 4,
                          width: 28,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: index === subtasks.length - 1 ? '#9ca3af' : '#fff', fontSize: 12, fontWeight: '600' }}>▼</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Middle: Subtask content */}
                    <View style={{ flex: 1 }}>
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
                  </View>
                </View>
              ))}
            </View>

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
                onPress={handleUpdate}
                disabled={loading}
              >
                <Text style={styles.createButtonText}>
                  {loading ? 'Updating...' : 'Update Task'}
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
    fontSize: 20,
  },
  scheduleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  scheduleInput: {
    flex: 1,
  },
  subtaskCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
