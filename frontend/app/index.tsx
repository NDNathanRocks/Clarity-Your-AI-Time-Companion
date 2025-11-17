import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  RefreshControl,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import axios from 'axios';
import AddTaskModal from './components/AddTaskModal';
import EditTaskModal from './components/EditTaskModal';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Use your laptop's IP address for mobile devices to connect
// Change this to your laptop's local IP (run 'ipconfig' on Windows or 'ifconfig' on Mac)
const API_BASE_URL = Platform.OS === 'web' 
  ? 'http://localhost:8000/api'
  : 'http://172.16.82.137:8000/api';  // Your laptop's local IP

console.log('[CONFIG] API Base URL:', API_BASE_URL);
console.log('[CONFIG] Platform:', Platform.OS);

// Configure axios
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to ensure token is always included
api.interceptors.request.use(
  async (config) => {
    // Get token from AsyncStorage if not in headers
    if (!config.headers.Authorization) {
      const token = await AsyncStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Token ${token}`;
      }
    }
    console.log(`[API REQUEST] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('[API REQUEST ERROR]', error);
    return Promise.reject(error);
  }
);

// Priority color scheme (pastel colors)
const PRIORITY_COLORS = {
  low: '#B8E6B8',     // Pastel green
  medium: '#FFF4B8',  // Pastel yellow
  high: '#FFB8B8'     // Pastel red/pink
};

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

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
  parent_task: number | null;
  title: string;
  description: string;
  due_date: string | null;
  estimated_duration_minutes: number;
  ai_friendly_message: string;
  status: 'pending' | 'in_progress' | 'done' | 'overdue';
  subtasks: Subtask[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  calendar_event_id?: string | null;
  priority?: 'low' | 'medium' | 'high';
  location?: string | null;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description: string;
  location: string;
  source: 'google_calendar' | 'app';
  color?: string;
  all_day?: boolean;
}

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface UserProfile {
  id: number;
  user: User;
  has_google_calendar: boolean;
  created_at: string;
  updated_at: string;
}

// Helper function to format duration
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

// ============================================================================
// AUTHENTICATION CONTEXT
// ============================================================================

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = React.createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  token: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  loading: true,
});

// ============================================================================
// AUTHENTICATION PROVIDER
// ============================================================================

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Token ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  }, [token]);

  const checkAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('authToken');
      const storedUser = await AsyncStorage.getItem('user');

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Error checking auth:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    try {
      console.log('[LOGIN] Attempting login...');
      console.log('[LOGIN] API Base URL:', API_BASE_URL);
      const response = await api.post('/login/', { username, password });
      console.log('[LOGIN] Response received:', response.status);
      const { token: authToken, user: userData } = response.data;

      await AsyncStorage.setItem('authToken', authToken);
      await AsyncStorage.setItem('user', JSON.stringify(userData));

      setToken(authToken);
      setUser(userData);
      setIsAuthenticated(true);
      console.log('[LOGIN] Login successful');
    } catch (error: any) {
      console.error('[LOGIN] Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        code: error.code,
      });
      
      // Provide user-friendly error messages
      let errorMessage = 'Login failed';
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        errorMessage = 'Connection timeout. Make sure your phone and laptop are on the same WiFi network.';
      } else if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        errorMessage = `Cannot connect to server at ${API_BASE_URL}. Make sure:\n1. Backend is running\n2. Both devices are on same WiFi\n3. Firewall allows connection`;
      } else if (error.response?.status === 401) {
        errorMessage = 'Invalid username or password';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      
      throw new Error(errorMessage);
    }
  };

  const register = async (username: string, email: string, password: string) => {
    try {
      console.log('[REGISTER] Attempting registration...');
      console.log('[REGISTER] API Base URL:', API_BASE_URL);
      const response = await api.post('/register/', {
        username,
        email,
        password,
      });
      console.log('[REGISTER] Response received:', response.status);
      const { token: authToken, user: userData } = response.data;

      await AsyncStorage.setItem('authToken', authToken);
      await AsyncStorage.setItem('user', JSON.stringify(userData));

      setToken(authToken);
      setUser(userData);
      setIsAuthenticated(true);
      console.log('[REGISTER] Registration successful');
    } catch (error: any) {
      console.error('[REGISTER] Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        code: error.code,
      });
      
      // Provide user-friendly error messages
      let errorMessage = 'Registration failed';
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        errorMessage = 'Connection timeout. Make sure your phone and laptop are on the same WiFi network.';
      } else if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        errorMessage = `Cannot connect to server at ${API_BASE_URL}. Make sure:\n1. Backend is running\n2. Both devices are on same WiFi\n3. Firewall allows connection`;
      } else if (error.response?.data?.username) {
        errorMessage = `Username: ${error.response.data.username[0]}`;
      } else if (error.response?.data?.email) {
        errorMessage = `Email: ${error.response.data.email[0]}`;
      } else if (error.response?.data?.password) {
        errorMessage = `Password: ${error.response.data.password[0]}`;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      
      throw new Error(errorMessage);
    }
  };

  const logout = async () => {
    try {
      console.log('[LOGOUT] Starting logout process...');
      await api.post('/logout/');
      console.log('[LOGOUT] Backend logout successful');
    } catch (error) {
      console.error('[LOGOUT] Backend logout error:', error);
    } finally {
      console.log('[LOGOUT] Clearing local storage and state...');
      
      // Clear storage and state
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('user');
      console.log('[LOGOUT] AsyncStorage cleared');
      
      // Clear axios auth header
      delete api.defaults.headers.common['Authorization'];
      console.log('[LOGOUT] Axios header cleared');
      
      // Update state to trigger navigation reset
      setIsAuthenticated(false);
      setToken(null);
      setUser(null);
      
      console.log('[LOGOUT] State cleared, auth should be false now');
      
      // Force a brief loading state to ensure navigation resets
      setLoading(true);
      setTimeout(() => {
        console.log('[LOGOUT] Resetting loading state');
        setLoading(false);
      }, 100);
    }
  };

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, user, token, login, register, logout, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ============================================================================
// AUTH SCREENS
// ============================================================================

const LoginScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = React.useContext(AuthContext);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please enter both username and password');
      return;
    }

    setLoading(true);
    try {
      await login(username, password);
    } catch (error: any) {
      Alert.alert('Login Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.authContainer}>
      <Text style={styles.appTitle}>Clarity</Text>
      <Text style={styles.subtitle}>Your AI Time Awareness Assistant</Text>

      <View style={styles.authForm}>
        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => navigation.navigate('Register')}
        >
          <Text style={styles.linkText}>Don't have an account? Register</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const RegisterScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = React.useContext(AuthContext);

  const handleRegister = async () => {
    if (!username || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      await register(username, email, password);
    } catch (error: any) {
      Alert.alert('Registration Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.authContainer}>
      <Text style={styles.appTitle}>Create Account</Text>

      <View style={styles.authForm}>
        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Register</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.linkText}>Already have an account? Login</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ============================================================================
// HOME SCREEN
// ============================================================================

const HomeScreen: React.FC = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user, isAuthenticated, token } = React.useContext(AuthContext);

  useEffect(() => {
    // Wait for auth to be ready before fetching
    if (isAuthenticated && token) {
      fetchData();
    }
  }, [isAuthenticated, token]);

  const fetchData = async () => {
    try {
      console.log('[HOME] Fetching data...');
      
      // Small delay to ensure token is set in axios headers
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const [eventsResponse, tasksResponse] = await Promise.all([
        api.get('/calendar/events/'),
        api.get('/tasks/'),
      ]);

      console.log('[HOME] Events response:', eventsResponse.data);
      console.log('[HOME] Tasks response:', tasksResponse.data);

      // Handle events response
      const eventsData = eventsResponse.data.events || eventsResponse.data || [];
      setEvents(eventsData);
      
      // Filter for today's tasks
      setTasks(tasksResponse.data.filter((t: Task) => t.status === 'pending'));
    } catch (error: any) {
      console.error('[HOME] Error fetching data:', error);
      
      // If auth error, retry once after a delay
      if (error.response?.status === 401) {
        console.log('[HOME] Got 401, retrying in 200ms...');
        await new Promise(resolve => setTimeout(resolve, 200));
        try {
          const [eventsResponse, tasksResponse] = await Promise.all([
            api.get('/calendar/events/'),
            api.get('/tasks/'),
          ]);
          const eventsData = eventsResponse.data.events || eventsResponse.data || [];
          setEvents(eventsData);
          setTasks(tasksResponse.data.filter((t: Task) => t.status === 'pending'));
        } catch (retryError) {
          console.error('[HOME] Retry failed:', retryError);
          setEvents([]);
          setTasks([]);
        }
      } else {
        setEvents([]);
        setTasks([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Welcome back, {user?.first_name || user?.username}!</Text>
        <Text style={styles.headerSubtitle}>Here's your day at a glance</Text>
      </View>

      {/* Today's Tasks */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📝 Today's Tasks ({tasks.length})</Text>
        {tasks.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>No tasks yet. Add one to get started!</Text>
          </View>
        ) : (
          tasks.slice(0, 5).map((task) => (
            <View key={task.id} style={styles.card}>
              <Text style={styles.cardTitle}>{task.title}</Text>
              <Text style={styles.cardSubtitle}>
                ⏱️ Estimated: {formatDuration(task.estimated_duration_minutes)}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Calendar Events */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📅 Upcoming Events ({events.length})</Text>
        {events.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              No upcoming events. Add one in the Calendar tab!
            </Text>
          </View>
        ) : (
          events.slice(0, 5).map((event) => {
            const startDate = new Date(event.start);
            const isToday = startDate.toDateString() === new Date().toDateString();
            const dateStr = isToday 
              ? `Today at ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : startDate.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            
            return (
              <View key={event.id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: event.color || '#6366f1' }]}>
                <Text style={styles.cardTitle}>{event.title}</Text>
                <Text style={styles.cardSubtitle}>📅 {dateStr}</Text>
                {event.location && (
                  <Text style={styles.cardSubtitle}>📍 {event.location}</Text>
                )}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
};

// ============================================================================
// CALENDAR SCREEN
// ============================================================================

const CalendarScreen: React.FC = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addEventModalVisible, setAddEventModalVisible] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day; // Start on Sunday
    return new Date(now.setDate(diff));
  });
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    location: '',
    start_time: new Date(),
    end_time: new Date(Date.now() + 3600000),
  });
  const isFocused = useIsFocused();

  useEffect(() => {
    fetchEvents();
  }, [currentWeekStart]);

  // Refresh calendar when tab is focused (after task operations)
  useEffect(() => {
    if (isFocused) {
      fetchEvents();
    }
  }, [isFocused]);

  const fetchEvents = async () => {
    try {
      const response = await api.get('/calendar/events/');
      setEvents(response.data.events || []);
    } catch (error: any) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleAddEvent = async () => {
    if (!newEvent.title.trim()) {
      Alert.alert('Error', 'Enter event title');
      return;
    }

    try {
      const eventData = {
        title: newEvent.title,
        description: newEvent.description,
        location: newEvent.location,
        start_time: newEvent.start_time.toISOString(),
        end_time: newEvent.end_time.toISOString(),
        all_day: false,
        color: '#6366f1',
      };

      await api.post('/events/create/', eventData);
      Alert.alert('Success', 'Event created!');
      setAddEventModalVisible(false);
      setNewEvent({
        title: '',
        description: '',
        location: '',
        start_time: new Date(),
        end_time: new Date(Date.now() + 3600000),
      });
      await fetchEvents();
    } catch (error: any) {
      console.error('Create event error:', error);
      Alert.alert('Error', 'Failed to create event');
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!eventId.startsWith('app-')) {
      Alert.alert('Info', 'Can only delete app events');
      return;
    }

    const confirmDelete = Platform.OS === 'web'
      ? window.confirm('Delete this event?')
      : true;

    if (Platform.OS === 'web' && confirmDelete) {
      deleteEvent(eventId);
    } else if (Platform.OS !== 'web') {
      Alert.alert('Delete Event', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteEvent(eventId) },
      ]);
    }
  };

  const deleteEvent = async (eventId: string) => {
    try {
      const id = eventId.replace('app-', '');
      await api.delete(`/events/${id}/delete/`);
      fetchEvents();
    } catch (error) {
      Alert.alert('Error', 'Failed to delete event');
    }
  };

  const getWeekDays = () => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(currentWeekStart);
      day.setDate(currentWeekStart.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const getEventsForDay = (day: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.start);
      return (
        eventDate.getDate() === day.getDate() &&
        eventDate.getMonth() === day.getMonth() &&
        eventDate.getFullYear() === day.getFullYear()
      );
    });
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + (direction === 'next' ? 7 : -7));
    setCurrentWeekStart(newStart);
  };

  const goToToday = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day;
    setCurrentWeekStart(new Date(now.setDate(diff)));
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const weekDays = getWeekDays();
  const weekStart = currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEnd = weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <View style={styles.container}>
      {/* Header with Week Navigation */}
      <View style={{ backgroundColor: '#6366f1', paddingTop: 50, paddingBottom: 15 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 }}>
          <TouchableOpacity onPress={() => navigateWeek('prev')} style={{ padding: 10 }}>
            <Text style={{ color: '#fff', fontSize: 24 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>{weekStart} - {weekEnd}</Text>
            <TouchableOpacity onPress={goToToday}>
              <Text style={{ color: '#cbd5e1', fontSize: 13, marginTop: 3 }}>Today</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => navigateWeek('next')} style={{ padding: 10 }}>
            <Text style={{ color: '#fff', fontSize: 24 }}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Week View Grid */}
      <ScrollView 
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEvents(); }} />}
      >
        {weekDays.map((day, index) => {
          const dayEvents = getEventsForDay(day);
          const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
          const dayNum = day.getDate();
          
          return (
            <View key={index} style={{ borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
              {/* Day Header */}
              <View style={{
                flexDirection: 'row',
                paddingVertical: 12,
                paddingHorizontal: 15,
                backgroundColor: isToday(day) ? '#eff6ff' : '#fff',
                borderLeftWidth: isToday(day) ? 3 : 0,
                borderLeftColor: '#6366f1',
              }}>
                <View style={{ width: 60 }}>
                  <Text style={{ fontSize: 12, color: '#6b7280', fontWeight: '500' }}>{dayName}</Text>
                  <Text style={{ fontSize: 20, color: isToday(day) ? '#6366f1' : '#111827', fontWeight: '600' }}>{dayNum}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  {dayEvents.length === 0 ? (
                    <Text style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', marginTop: 8 }}>No events</Text>
                  ) : (
                    dayEvents.map((event, idx) => {
                      const startTime = new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                      const endTime = new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                      
                      return (
                        <TouchableOpacity
                          key={idx}
                          onLongPress={() => handleDeleteEvent(event.id)}
                          style={{
                            backgroundColor: event.color || '#6366f1',
                            borderRadius: 6,
                            padding: 8,
                            marginBottom: idx < dayEvents.length - 1 ? 6 : 0,
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{event.title}</Text>
                          <Text style={{ color: '#e0e7ff', fontSize: 11, marginTop: 2 }}>
                            {startTime} - {endTime}
                          </Text>
                          {event.location && (
                            <Text style={{ color: '#e0e7ff', fontSize: 11, marginTop: 1 }}>📍 {event.location}</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Floating Add Button */}
      <TouchableOpacity
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: '#6366f1',
          justifyContent: 'center',
          alignItems: 'center',
          elevation: 5,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
        }}
        onPress={() => setAddEventModalVisible(true)}
      >
        <Text style={{ color: '#fff', fontSize: 28, fontWeight: '300' }}>+</Text>
      </TouchableOpacity>

      {/* Add Event Modal - With Date/Time Picker */}
      <Modal
        visible={addEventModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddEventModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ justifyContent: 'center', flex: 1 }}>
            <View style={[styles.modalContent, { width: '90%', maxWidth: 400, alignSelf: 'center' }]}>
              <Text style={styles.modalTitle}>New Event</Text>

              <TextInput
                style={styles.input}
                placeholder="Title *"
                value={newEvent.title}
                onChangeText={(text) => setNewEvent({ ...newEvent, title: text })}
              />

              <TextInput
                style={styles.input}
                placeholder="Location"
                value={newEvent.location}
                onChangeText={(text) => setNewEvent({ ...newEvent, location: text })}
              />

              {/* Date Selection with Scroll Wheels */}
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 }}>Date</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                {/* Month Picker */}
                <View style={{ flex: 1 }}>
                  <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, index) => (
                      <TouchableOpacity
                        key={month}
                        style={{
                          padding: 12,
                          backgroundColor: newEvent.start_time.getMonth() === index ? '#6366f1' : 'transparent',
                          borderBottomWidth: 1,
                          borderBottomColor: '#e5e7eb',
                        }}
                        onPress={() => {
                          const date = new Date(newEvent.start_time);
                          date.setMonth(index);
                          const endDate = new Date(date);
                          endDate.setHours(date.getHours() + 1);
                          setNewEvent({ ...newEvent, start_time: date, end_time: endDate });
                        }}
                      >
                        <Text style={{ textAlign: 'center', color: newEvent.start_time.getMonth() === index ? '#fff' : '#374151', fontWeight: newEvent.start_time.getMonth() === index ? '600' : '400' }}>
                          {month}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Month</Text>
                </View>

                {/* Day Picker */}
                <View style={{ flex: 1 }}>
                  <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <TouchableOpacity
                        key={day}
                        style={{
                          padding: 12,
                          backgroundColor: newEvent.start_time.getDate() === day ? '#6366f1' : 'transparent',
                          borderBottomWidth: 1,
                          borderBottomColor: '#e5e7eb',
                        }}
                        onPress={() => {
                          const date = new Date(newEvent.start_time);
                          date.setDate(day);
                          const endDate = new Date(date);
                          endDate.setHours(date.getHours() + 1);
                          setNewEvent({ ...newEvent, start_time: date, end_time: endDate });
                        }}
                      >
                        <Text style={{ textAlign: 'center', color: newEvent.start_time.getDate() === day ? '#fff' : '#374151', fontWeight: newEvent.start_time.getDate() === day ? '600' : '400' }}>
                          {day}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Day</Text>
                </View>

                {/* Year Picker */}
                <View style={{ flex: 1 }}>
                  <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                    {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() + i).map(year => (
                      <TouchableOpacity
                        key={year}
                        style={{
                          padding: 12,
                          backgroundColor: newEvent.start_time.getFullYear() === year ? '#6366f1' : 'transparent',
                          borderBottomWidth: 1,
                          borderBottomColor: '#e5e7eb',
                        }}
                        onPress={() => {
                          const date = new Date(newEvent.start_time);
                          date.setFullYear(year);
                          const endDate = new Date(date);
                          endDate.setHours(date.getHours() + 1);
                          setNewEvent({ ...newEvent, start_time: date, end_time: endDate });
                        }}
                      >
                        <Text style={{ textAlign: 'center', color: newEvent.start_time.getFullYear() === year ? '#fff' : '#374151', fontWeight: newEvent.start_time.getFullYear() === year ? '600' : '400' }}>
                          {year}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Year</Text>
                </View>
              </View>

              <Text style={{ fontSize: 14, color: '#111827', fontWeight: '600', textAlign: 'center', marginTop: 12 }}>
                {newEvent.start_time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>

              {/* Time Selection */}
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 }}>Start Time</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                {/* Hour picker */}
                <View style={{ flex: 1 }}>
                  <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                    {Array.from({ length: 24 }, (_, i) => i).map(hour => (
                      <TouchableOpacity
                        key={hour}
                        style={{
                          padding: 12,
                          backgroundColor: newEvent.start_time.getHours() === hour ? '#6366f1' : 'transparent',
                          borderBottomWidth: 1,
                          borderBottomColor: '#e5e7eb',
                        }}
                        onPress={() => {
                          const date = new Date(newEvent.start_time);
                          date.setHours(hour);
                          const endDate = new Date(date);
                          endDate.setHours(hour + 1);
                          setNewEvent({ ...newEvent, start_time: date, end_time: endDate });
                        }}
                      >
                        <Text style={{ textAlign: 'center', color: newEvent.start_time.getHours() === hour ? '#fff' : '#374151', fontWeight: newEvent.start_time.getHours() === hour ? '600' : '400' }}>
                          {hour.toString().padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Hour</Text>
                </View>

                <Text style={{ fontSize: 20, color: '#6b7280' }}>:</Text>

                {/* Minute picker */}
                <View style={{ flex: 1 }}>
                  <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                    {[0, 15, 30, 45].map(minute => (
                      <TouchableOpacity
                        key={minute}
                        style={{
                          padding: 12,
                          backgroundColor: newEvent.start_time.getMinutes() === minute ? '#6366f1' : 'transparent',
                          borderBottomWidth: 1,
                          borderBottomColor: '#e5e7eb',
                        }}
                        onPress={() => {
                          const date = new Date(newEvent.start_time);
                          date.setMinutes(minute);
                          date.setSeconds(0);
                          const endDate = new Date(date);
                          endDate.setHours(date.getHours() + 1);
                          setNewEvent({ ...newEvent, start_time: date, end_time: endDate });
                        }}
                      >
                        <Text style={{ textAlign: 'center', color: newEvent.start_time.getMinutes() === minute ? '#fff' : '#374151', fontWeight: newEvent.start_time.getMinutes() === minute ? '600' : '400' }}>
                          {minute.toString().padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Minute</Text>
                </View>
              </View>

              {/* Duration Selection */}
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 }}>Duration</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.button, { flex: 1, backgroundColor: '#8b5cf6', padding: 10 }]}
                  onPress={() => {
                    const endDate = new Date(newEvent.start_time);
                    endDate.setMinutes(endDate.getMinutes() + 30);
                    setNewEvent({ ...newEvent, end_time: endDate });
                  }}
                >
                  <Text style={[styles.buttonText, { fontSize: 13 }]}>30min</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { flex: 1, backgroundColor: '#8b5cf6', padding: 10 }]}
                  onPress={() => {
                    const endDate = new Date(newEvent.start_time);
                    endDate.setHours(endDate.getHours() + 1);
                    setNewEvent({ ...newEvent, end_time: endDate });
                  }}
                >
                  <Text style={[styles.buttonText, { fontSize: 13 }]}>1hr</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { flex: 1, backgroundColor: '#8b5cf6', padding: 10 }]}
                  onPress={() => {
                    const endDate = new Date(newEvent.start_time);
                    endDate.setHours(endDate.getHours() + 2);
                    setNewEvent({ ...newEvent, end_time: endDate });
                  }}
                >
                  <Text style={[styles.buttonText, { fontSize: 13 }]}>2hr</Text>
                </TouchableOpacity>
              </View>

              <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 12, textAlign: 'center' }}>
                Ends: {newEvent.end_time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton, { flex: 1 }]}
                  onPress={handleAddEvent}
                >
                  <Text style={styles.buttonText}>Create</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { flex: 1, backgroundColor: '#6b7280' }]}
                  onPress={() => setAddEventModalVisible(false)}
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

// ============================================================================
// TASKS SCREEN
// ============================================================================

const TasksScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [addTaskModalVisible, setAddTaskModalVisible] = useState(false);
  const [editTaskModalVisible, setEditTaskModalVisible] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);
  
  // Date navigation
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  
  // Current time for "Active" status updates
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Clarity Breakdown states
  const [breakdownModalVisible, setBreakdownModalVisible] = useState(false);
  const [breakdownData, setBreakdownData] = useState<any>(null);
  const [editableSubtasks, setEditableSubtasks] = useState<any[]>([]);
  const [estimateData, setEstimateData] = useState<any>(null);

  // Task Scheduling states
  const [schedulingModalVisible, setSchedulingModalVisible] = useState(false);
  const [taskToSchedule, setTaskToSchedule] = useState<any>(null);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<Date | null>(null);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [busyPeriods, setBusyPeriods] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [tempScheduleDate, setTempScheduleDate] = useState(new Date());
  const [customTimeMode, setCustomTimeMode] = useState(false);
  const [customTimeHour, setCustomTimeHour] = useState(9);
  const [customTimeMinute, setCustomTimeMinute] = useState(0);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editDuration, setEditDuration] = useState(0);
  const isFocused = useIsFocused();

  useEffect(() => {
    fetchTasks();
  }, []);

  // Refresh tasks when tab is focused (after chat creates tasks)
  useEffect(() => {
    if (isFocused) {
      fetchTasks();
    }
  }, [isFocused]);

  // Update current time every minute for "Active" status
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  // Helper: Format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper: Check if date is today
  const isToday = (date: Date): boolean => {
    const today = new Date();
    return formatDate(date) === formatDate(today);
  };

  // Helper: Navigate to previous day
  const goToPreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  // Helper: Navigate to next day
  const goToNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  // Helper: Go to today
  const goToToday = () => {
    setSelectedDate(new Date());
  };

  // Filter tasks based on selected date and active/completed status
  const getFilteredTasks = (): Task[] => {
    const selectedDateStr = formatDate(selectedDate);
    
    return tasks.filter(task => {
      // Always show unscheduled tasks
      if (!task.scheduled_date) {
        return activeTab === 'active' ? task.status !== 'done' : task.status === 'done';
      }
      
      // Show tasks scheduled for selected date
      if (task.scheduled_date === selectedDateStr) {
        return activeTab === 'active' ? task.status !== 'done' : task.status === 'done';
      }
      
      return false;
    }).sort((a, b) => {
      // Sort unscheduled tasks first
      if (!a.scheduled_time && b.scheduled_time) return -1;
      if (a.scheduled_time && !b.scheduled_time) return 1;
      if (!a.scheduled_time && !b.scheduled_time) return 0;
      
      // Sort by scheduled time (most recent first)
      return (b.scheduled_time || '').localeCompare(a.scheduled_time || '');
    });
  };

  // Helper: Get time until task starts
  const getTimeUntilStart = (task: Task): string => {
    if (!task.scheduled_date || !task.scheduled_time) return '';
    
    const taskDateTime = new Date(`${task.scheduled_date}T${task.scheduled_time}`);
    const diff = taskDateTime.getTime() - currentTime.getTime();
    
    if (diff < 0) {
      // Task has started
      const endTime = new Date(taskDateTime.getTime() + task.estimated_duration_minutes * 60000);
      if (currentTime < endTime) {
        return 'Active';
      }
      return 'Overdue';
    }
    
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    
    if (hours > 0) {
      return `${hours}hr ${minutes}min until start`;
    }
    return `${minutes}min until start`;
  };

  const fetchTasks = async () => {
    try {
      const response = await api.get('/tasks/');
      setTasks(response.data);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) {
      Alert.alert('Error', 'Please enter a task title');
      return;
    }

    setEstimating(true);
    try {
      // Step 1: Get AI estimate (doesn't create task yet)
      const estimateResponse = await api.post('/tasks/estimate/', {
        title: newTaskTitle,
      });
      
      console.log('[TASKS] Estimate response:', estimateResponse.data);
      setEstimateData(estimateResponse.data);
      
      // Step 2: Check if task should be broken down
      const breakdownResponse = await api.post('/tasks/breakdown/', {
        title: newTaskTitle,
        description: '',
      });
      
      console.log('[TASKS] Breakdown response:', breakdownResponse.data);
      
      if (breakdownResponse.data.should_break_down && breakdownResponse.data.suggested_subtasks.length > 0) {
        // Show breakdown modal with editable subtasks
        setBreakdownData(breakdownResponse.data);
        setEditableSubtasks(breakdownResponse.data.suggested_subtasks.map((st: any) => ({ ...st })));
        setBreakdownModalVisible(true);
        setEstimating(false); // Stop loading, user needs to decide
      } else {
        // Task is simple, create it as single task
        const response = await api.post('/tasks/create/', {
          title: newTaskTitle,
          description: '',
          estimated_minutes: estimateResponse.data.estimate_minutes,
          ai_message: estimateResponse.data.friendly_message,
          subtasks: [],
        });
        
        const createdTask = response.data.task;
        console.log('[TASKS] Created task:', createdTask);
        
        setNewTaskTitle('');
        setEstimateData(null);
        fetchTasks();
        setEstimating(false);
        
        // Prompt scheduling
        setTaskToSchedule(createdTask);
        setSchedulingModalVisible(true);
      }
    } catch (error: any) {
      console.error('[TASKS] Error:', error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to add task');
      setEstimating(false);
    }
  };
  
  const handleAcceptBreakdown = async () => {
    if (!breakdownData || !estimateData) return;
    
    try {
      setEstimating(true);
      
      // Create task with subtasks (using edited versions)
      const response = await api.post('/tasks/create/', {
        title: newTaskTitle,
        description: '',
        estimated_minutes: editableSubtasks.reduce((sum, st) => sum + st.estimated_minutes, 0),
        ai_message: breakdownData.witty_message,
        subtasks: editableSubtasks,
      });
      
      const createdTask = response.data.task;
      console.log('[TASKS] Created task with breakdown:', createdTask);
      
      // Close breakdown modal
      setNewTaskTitle('');
      setBreakdownModalVisible(false);
      setBreakdownData(null);
      setEstimateData(null);
      fetchTasks();
      
      // Prompt scheduling
      setTaskToSchedule(createdTask);
      setSchedulingModalVisible(true);
    } catch (error: any) {
      console.error('[TASKS] Error creating breakdown:', error);
      Alert.alert('Error', 'Failed to create task breakdown');
    } finally {
      setEstimating(false);
    }
  };
  
  const handleDeclineBreakdown = async () => {
    // User declined breakdown, create as single task
    try {
      setEstimating(true);
      
      const response = await api.post('/tasks/create/', {
        title: newTaskTitle,
        description: '',
        estimated_minutes: estimateData.estimate_minutes,
        ai_message: estimateData.friendly_message,
        subtasks: [],
      });
      
      const createdTask = response.data.task;
      console.log('[TASKS] Created task (declined breakdown):', createdTask);
      
      // Close breakdown modal
      setNewTaskTitle('');
      setBreakdownModalVisible(false);
      setBreakdownData(null);
      setEstimateData(null);
      fetchTasks();
      
      // Prompt scheduling
      setTaskToSchedule(createdTask);
      setSchedulingModalVisible(true);
    } catch (error: any) {
      console.error('[TASKS] Error creating task:', error);
      Alert.alert('Error', 'Failed to create task');
    } finally {
      setEstimating(false);
    }
  };

  const handleTaskPress = (task: Task) => {
    if (task.status === 'pending' || task.status === 'in_progress') {
      setSelectedTask(task);
      setFeedbackModalVisible(true);
    }
  };

  const handleFeedback = async (feedback: string) => {
    if (!selectedTask) return;

    try {
      await api.post('/tasks/feedback/', {
        task_id: selectedTask.id,
        feedback: feedback,
      });

      // If completing main task, mark all subtasks as done too
      if (selectedTask.subtasks && selectedTask.subtasks.length > 0) {
        for (const subtask of selectedTask.subtasks) {
          if (subtask.id) {
            await api.post(`/tasks/${subtask.id}/`, { status: 'done' });
          }
        }
      }

      Alert.alert('Thanks!', 'Your feedback helps me learn 🎯');
      setFeedbackModalVisible(false);
      setSelectedTask(null);
      fetchTasks();
    } catch (error) {
      Alert.alert('Error', 'Failed to save feedback');
    }
  };

  // Get contextual feedback options based on task
  const getFeedbackOptions = (task: Task | null) => {
    if (!task) return [];
    
    const baseOptions = [
      { key: 'easy', label: '😊 Had plenty of time, it was easy', color: '#10b981' },
      { key: 'on_time', label: '✅ Just right', color: '#6366f1' },
      { key: 'rushed', label: '😰 I felt rushed', color: '#f59e0b' },
      { key: 'very_late', label: '⚠️ Way too little time', color: '#ef4444' },
    ];
    
    return baseOptions;
  };

  const handleMarkIncomplete = async (task: Task) => {
    try {
      await api.post(`/tasks/${task.id}/`, {
        status: 'pending',
        completed_at: null,
      });
      
      // Also mark subtasks as incomplete if they exist
      if (task.subtasks && task.subtasks.length > 0) {
        for (const subtask of task.subtasks) {
          if (subtask.id) {
            await api.post(`/tasks/${subtask.id}/`, { 
              status: 'pending',
              completed_at: null 
            });
          }
        }
      }

      Alert.alert('Task Reopened', 'Task marked as incomplete');
      fetchTasks();
    } catch (error) {
      Alert.alert('Error', 'Failed to reopen task');
    }
  };

  const handleFindSlots = async (date: Date) => {
    if (!taskToSchedule) return;
    
    setLoadingSlots(true);
    try {
      // Format date as YYYY-MM-DD in local timezone
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      console.log('[SCHEDULE] Finding slots for date:', dateStr);
      const response = await api.post('/tasks/find-slots/', {
        task_id: taskToSchedule.id,
        date: dateStr,
      });
      
      console.log('[SCHEDULE] Available slots:', response.data);
      setAvailableSlots(response.data.available_slots || []);
      setBusyPeriods(response.data.busy_periods || []);
      setSelectedScheduleDate(date);
      setCustomTimeMode(false);
    } catch (error: any) {
      console.error('[SCHEDULE] Error finding slots:', error);
      console.error('[SCHEDULE] Error response:', error.response?.data);
      Alert.alert('Error', 'Failed to find available time slots');
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleScheduleTask = async (timeSlot?: string) => {
    if (!taskToSchedule || !selectedScheduleDate) return;
    
    // Use custom time if in custom mode, otherwise use provided slot
    const time = customTimeMode 
      ? `${String(customTimeHour).padStart(2, '0')}:${String(customTimeMinute).padStart(2, '0')}`
      : timeSlot;
    
    if (!time) return;
    
    setScheduling(true);
    try {
      const year = selectedScheduleDate.getFullYear();
      const month = String(selectedScheduleDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedScheduleDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      // Use reschedule endpoint if task already has a schedule
      const endpoint = taskToSchedule.scheduled_date ? '/tasks/reschedule/' : '/tasks/schedule/';
      
      console.log('[SCHEDULE] Scheduling task:', { task_id: taskToSchedule.id, date: dateStr, time, endpoint });
      const response = await api.post(endpoint, {
        task_id: taskToSchedule.id,
        date: dateStr,
        time: time,
      });
      
      console.log('[SCHEDULE] Task scheduled:', response.data);
      const message = taskToSchedule.scheduled_date ? 'Rescheduled!' : 'Scheduled!';
      Alert.alert(`✅ ${message}`, `Task ${taskToSchedule.scheduled_date ? 'rescheduled' : 'scheduled'} for ${dateStr} at ${time}`);
      
      // Close modal and refresh tasks (calendar refreshes on focus)
      setSchedulingModalVisible(false);
      setTaskToSchedule(null);
      setSelectedScheduleDate(null);
      setAvailableSlots([]);
      fetchTasks();
    } catch (error: any) {
      console.error('[SCHEDULE] Error scheduling task:', error);
      Alert.alert('Error', 'Failed to schedule task');
    } finally {
      setScheduling(false);
    }
  };

  const handleSkipScheduling = () => {
    setSchedulingModalVisible(false);
    setTaskToSchedule(null);
    setSelectedScheduleDate(null);
    setAvailableSlots([]);
  };

  const handleDeleteTask = async (taskId: number, taskTitle: string) => {
    const confirmDelete = Platform.OS === 'web'
      ? window.confirm(`Are you sure you want to delete "${taskTitle}"?`)
      : true;

    const performDelete = async () => {
      try {
        console.log('[TASKS] Deleting task:', taskId);
        await api.delete(`/tasks/${taskId}/delete/`);
        console.log('[TASKS] Task deleted successfully');
        fetchTasks(); // Calendar will auto-refresh on focus
      } catch (error: any) {
        console.error('[TASKS] Error deleting task:', error);
        console.error('[TASKS] Error response:', error.response?.data);
        Alert.alert('Error', 'Failed to delete task');
      }
    };

    if (Platform.OS === 'web' && confirmDelete) {
      performDelete();
    } else if (Platform.OS !== 'web') {
      Alert.alert(
        'Delete Task',
        `Are you sure you want to delete "${taskTitle}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: performDelete,
          },
        ]
      );
    }
  };

  const toggleTaskExpansion = (taskId: number) => {
    setExpandedTasks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const renderTask = (task: Task, isSubtask: boolean = false) => {
    const isExpanded = expandedTasks.has(task.id);
    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
    const priorityColor = task.priority ? PRIORITY_COLORS[task.priority] : PRIORITY_COLORS.medium;
    const timeStatus = getTimeUntilStart(task);

    return (
      <View key={task.id}>
        <View
          style={[
            styles.taskCard,
            task.status === 'done' && styles.taskCardDone,
            isSubtask && styles.subtaskCardStyle,
            { borderLeftWidth: 4, borderLeftColor: priorityColor },
          ]}
        >
          <TouchableOpacity
            style={styles.taskCardContent}
            onPress={() => {
              if (hasSubtasks) {
                toggleTaskExpansion(task.id);
              } else if (task.status !== 'done') {
                setSelectedTask(task);
                setFeedbackModalVisible(true);
              }
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {hasSubtasks && (
                <Text style={{ marginRight: 8, fontSize: 16 }}>
                  {isExpanded ? '▼' : '▶'}
                </Text>
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.taskTitle,
                    task.status === 'done' && styles.taskTitleDone,
                    isSubtask && styles.subtaskTitleStyle,
                  ]}
                >
                  {task.title}
                </Text>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 8 }}>
                  <Text style={styles.taskMeta}>
                    ⏱️ {formatDuration(task.estimated_duration_minutes)}
                  </Text>
                  {task.priority && (
                    <View style={{ backgroundColor: priorityColor, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151' }}>
                        {task.priority.toUpperCase()}
                      </Text>
                    </View>
                  )}
                  {timeStatus && (
                    <View style={{ 
                      backgroundColor: timeStatus === 'Active' ? '#10b981' : timeStatus === 'Overdue' ? '#ef4444' : '#6366f1', 
                      paddingHorizontal: 8, 
                      paddingVertical: 3, 
                      borderRadius: 4 
                    }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#fff' }}>
                        {timeStatus}
                      </Text>
                    </View>
                  )}
                </View>
                
                {task.location && (
                  <Text style={[styles.taskMeta, { marginTop: 4 }]}>
                    📍 {task.location.substring(0, 30)}{task.location.length > 30 ? '...' : ''}
                  </Text>
                )}
                
                {task.scheduled_date && task.scheduled_time && (
                  <Text style={[styles.taskMeta, { marginTop: 4 }]}>
                    📅 {task.scheduled_date} at {task.scheduled_time.substring(0, 5)}
                  </Text>
                )}
                
                {hasSubtasks && (
                  <Text style={[styles.taskMeta, { marginTop: 4 }]}>
                    📋 {task.subtasks.length} subtasks
                  </Text>
                )}
                
                {task.ai_friendly_message && !isSubtask && (
                  <Text style={styles.taskMessage}>
                    💡 {task.ai_friendly_message}
                  </Text>
                )}
                
                {/* Action Buttons */}
                {!isSubtask && task.status !== 'done' && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      style={{ backgroundColor: '#8b5cf6', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12, flex: 1 }}
                      onPress={() => {
                        setTaskToEdit(task);
                        setEditTaskModalVisible(true);
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                        ✏️ Edit
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ backgroundColor: '#6366f1', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12, flex: 1 }}
                      onPress={() => {
                        if (navigation) {
                          navigation.navigate('Chat', {
                            prefillMessage: `Update my task: "${task.title}". Currently scheduled for ${task.scheduled_date || 'not scheduled'} at ${task.scheduled_time?.substring(0, 5) || 'no time'}. Duration: ${formatDuration(task.estimated_duration_minutes)}. Priority: ${task.priority || 'medium'}. Location: ${task.location || 'none'}.`
                          });
                        }
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                        ✨ Edit with Clarity
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                
                {/* Undo button for completed tasks */}
                {!isSubtask && task.status === 'done' && (
                  <TouchableOpacity
                    style={{ backgroundColor: '#f59e0b', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12, marginTop: 12 }}
                    onPress={() => handleMarkIncomplete(task)}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                      ↩️ Mark as Incomplete
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </TouchableOpacity>
          
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={styles.taskStatus}>
              <Text style={styles.taskStatusText}>
                {task.status === 'done' ? '✅' : '⏳'}
              </Text>
            </View>
            {task.status !== 'done' && (
              <TouchableOpacity
                onPress={() => handleDeleteTask(task.id, task.title)}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteButtonText}>🗑️</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Render subtasks if expanded */}
        {hasSubtasks && isExpanded && (
          <View style={styles.subtasksContainer}>
            {task.subtasks.map((subtask, index) => {
              const duration = subtask.estimated_duration_minutes || 0;
              const hours = Math.floor(duration / 60);
              const mins = duration % 60;
              const durationStr = hours > 0 
                ? `${hours}hr ${mins}min`
                : `${mins}min`;
              
              return (
                <View key={subtask.id || index} style={styles.subtaskItem}>
                  <Text style={styles.subtaskBullet}>•</Text>
                  <Text style={styles.subtaskTitle}>{subtask.title}</Text>
                  <Text style={styles.subtaskDuration}>{durationStr}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Tasks</Text>
        <Text style={styles.headerSubtitle}>AI-powered time estimates</Text>
      </View>

      {/* Date Navigation */}
      <View style={{ backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity
            onPress={goToPreviousDay}
            style={{ padding: 8, backgroundColor: '#f3f4f6', borderRadius: 8 }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#374151' }}>←</Text>
          </TouchableOpacity>
          
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>
              {isToday(selectedDate) ? 'Today' : selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}
            </Text>
          </View>
          
          <TouchableOpacity
            onPress={goToNextDay}
            style={{ padding: 8, backgroundColor: '#f3f4f6', borderRadius: 8 }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#374151' }}>→</Text>
          </TouchableOpacity>
        </View>
        
        {!isToday(selectedDate) && (
          <TouchableOpacity
            onPress={goToToday}
            style={{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#6366f1', borderRadius: 6, alignSelf: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Go to Today</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Active/Completed Tabs */}
      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
        <TouchableOpacity
          onPress={() => setActiveTab('active')}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderBottomWidth: 3,
            borderBottomColor: activeTab === 'active' ? '#6366f1' : 'transparent',
          }}
        >
          <Text style={{
            textAlign: 'center',
            fontSize: 15,
            fontWeight: '600',
            color: activeTab === 'active' ? '#6366f1' : '#9ca3af',
          }}>
            Active ({getFilteredTasks().filter(t => t.status !== 'done').length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('completed')}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderBottomWidth: 3,
            borderBottomColor: activeTab === 'completed' ? '#6366f1' : 'transparent',
          }}
        >
          <Text style={{
            textAlign: 'center',
            fontSize: 15,
            fontWeight: '600',
            color: activeTab === 'completed' ? '#6366f1' : '#9ca3af',
          }}>
            Completed ({getFilteredTasks().filter(t => t.status === 'done').length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Add Task Button */}
      <TouchableOpacity
        style={styles.addTaskButton}
        onPress={() => setAddTaskModalVisible(true)}
      >
        <Text style={styles.addTaskButtonText}>+ Add Task</Text>
      </TouchableOpacity>

      {/* Add Task Modal */}
      <AddTaskModal
        visible={addTaskModalVisible}
        onClose={() => setAddTaskModalVisible(false)}
        onTaskCreated={() => {
          fetchTasks();
          setAddTaskModalVisible(false);
        }}
      />

      {/* Edit Task Modal */}
      <EditTaskModal
        visible={editTaskModalVisible}
        task={taskToEdit}
        onClose={() => {
          setEditTaskModalVisible(false);
          setTaskToEdit(null);
        }}
        onTaskUpdated={() => {
          fetchTasks();
          setEditTaskModalVisible(false);
          setTaskToEdit(null);
        }}
      />

      {/* Tasks List */}
      <ScrollView style={styles.tasksList}>
        {getFilteredTasks().length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {activeTab === 'active' 
                ? 'No active tasks for this day. Add a new task above!' 
                : 'No completed tasks for this day.'}
            </Text>
          </View>
        ) : (
          getFilteredTasks().map((task) => renderTask(task))
        )}
      </ScrollView>

      {/* Feedback Modal */}
      <Modal
        visible={feedbackModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFeedbackModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>How did it go?</Text>
            <Text style={styles.modalSubtitle}>{selectedTask?.title}</Text>

            {getFeedbackOptions(selectedTask).map((option) => (
              <TouchableOpacity
                key={option.key}
                style={[styles.feedbackButton, { backgroundColor: option.color }]}
                onPress={() => handleFeedback(option.key)}
              >
                <Text style={styles.feedbackButtonText}>{option.label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setFeedbackModalVisible(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Clarity Breakdown Modal */}
      <Modal
        visible={breakdownModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBreakdownModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.breakdownModalContent}>
            <Text style={styles.breakdownTitle}>✨ The Clarity Breakdown</Text>
            <Text style={styles.breakdownMessage}>
              {breakdownData?.witty_message || "I think this task could be broken down into smaller steps!"}
            </Text>
            
            <Text style={styles.breakdownReasoning}>
              {breakdownData?.reasoning}
            </Text>

            <Text style={styles.subtasksTitle}>Edit Subtasks (tap to edit):</Text>
            {editableSubtasks?.map((subtask: any, index: number) => (
              <View key={index} style={styles.subtaskCard}>
                <Text style={styles.subtaskNumber}>{index + 1}.</Text>
                <View style={styles.subtaskContent}>
                  <TextInput
                    style={[styles.subtaskTitle, { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 8, marginBottom: 4 }]}
                    value={subtask.title}
                    onChangeText={(text) => {
                      const updated = [...editableSubtasks];
                      updated[index].title = text;
                      setEditableSubtasks(updated);
                    }}
                    placeholder="Subtask name"
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Text style={{ fontSize: 13, color: '#6b7280' }}>Duration:</Text>
                    <TouchableOpacity
                      style={{ backgroundColor: '#ef4444', borderRadius: 6, padding: 6, minWidth: 32, alignItems: 'center' }}
                      onPress={() => {
                        const updated = [...editableSubtasks];
                        updated[index].estimated_minutes = Math.max(5, updated[index].estimated_minutes - 5);
                        setEditableSubtasks(updated);
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>-</Text>
                    </TouchableOpacity>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', minWidth: 60, textAlign: 'center' }}>
                      {subtask.estimated_minutes} min
                    </Text>
                    <TouchableOpacity
                      style={{ backgroundColor: '#10b981', borderRadius: 6, padding: 6, minWidth: 32, alignItems: 'center' }}
                      onPress={() => {
                        const updated = [...editableSubtasks];
                        updated[index].estimated_minutes = updated[index].estimated_minutes + 5;
                        setEditableSubtasks(updated);
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}

            <Text style={styles.totalTime}>
              Total: ~{editableSubtasks?.reduce((sum, st) => sum + st.estimated_minutes, 0)} minutes
            </Text>

            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { marginTop: 20 }]}
              onPress={handleAcceptBreakdown}
              disabled={estimating}
            >
              {estimating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>✅ Accept Breakdown</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: '#9ca3af', marginTop: 10 }]}
              onPress={handleDeclineBreakdown}
              disabled={estimating}
            >
              <Text style={styles.buttonText}>Keep As One Task</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Scheduling Modal */}
      <Modal
        visible={schedulingModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={handleSkipScheduling}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>📅 When to do this?</Text>
            <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, textAlign: 'center' }}>
              {taskToSchedule?.title} ({formatDuration(taskToSchedule?.estimated_duration_minutes || 0)})
            </Text>

            {/* Date Picker with Scroll Wheels */}
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 10, textAlign: 'center' }}>Select Date:</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              {/* Month Picker */}
              <View style={{ flex: 1 }}>
                <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, index) => (
                    <TouchableOpacity
                      key={month}
                      style={{
                        padding: 12,
                        backgroundColor: tempScheduleDate.getMonth() === index ? '#6366f1' : 'transparent',
                        borderBottomWidth: 1,
                        borderBottomColor: '#e5e7eb',
                      }}
                      onPress={() => {
                        const date = new Date(tempScheduleDate);
                        date.setMonth(index);
                        setTempScheduleDate(date);
                      }}
                    >
                      <Text style={{ textAlign: 'center', color: tempScheduleDate.getMonth() === index ? '#fff' : '#374151', fontWeight: tempScheduleDate.getMonth() === index ? '600' : '400' }}>
                        {month}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Month</Text>
              </View>

              {/* Day Picker */}
              <View style={{ flex: 1 }}>
                <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                    <TouchableOpacity
                      key={day}
                      style={{
                        padding: 12,
                        backgroundColor: tempScheduleDate.getDate() === day ? '#6366f1' : 'transparent',
                        borderBottomWidth: 1,
                        borderBottomColor: '#e5e7eb',
                      }}
                      onPress={() => {
                        const date = new Date(tempScheduleDate);
                        date.setDate(day);
                        setTempScheduleDate(date);
                      }}
                    >
                      <Text style={{ textAlign: 'center', color: tempScheduleDate.getDate() === day ? '#fff' : '#374151', fontWeight: tempScheduleDate.getDate() === day ? '600' : '400' }}>
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Day</Text>
              </View>

              {/* Year Picker */}
              <View style={{ flex: 1 }}>
                <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                  {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() + i).map(year => (
                    <TouchableOpacity
                      key={year}
                      style={{
                        padding: 12,
                        backgroundColor: tempScheduleDate.getFullYear() === year ? '#6366f1' : 'transparent',
                        borderBottomWidth: 1,
                        borderBottomColor: '#e5e7eb',
                      }}
                      onPress={() => {
                        const date = new Date(tempScheduleDate);
                        date.setFullYear(year);
                        setTempScheduleDate(date);
                      }}
                    >
                      <Text style={{ textAlign: 'center', color: tempScheduleDate.getFullYear() === year ? '#fff' : '#374151', fontWeight: tempScheduleDate.getFullYear() === year ? '600' : '400' }}>
                        {year}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Year</Text>
              </View>
            </View>

            <Text style={{ fontSize: 14, color: '#111827', fontWeight: '600', textAlign: 'center', marginBottom: 16 }}>
              {tempScheduleDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>

            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { marginBottom: 16 }]}
              onPress={() => handleFindSlots(tempScheduleDate)}
              disabled={loadingSlots}
            >
              {loadingSlots ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Find Available Slots</Text>
              )}
            </TouchableOpacity>

            {/* Loading indicator */}
            {loadingSlots && (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={{ marginTop: 10, color: '#6b7280' }}>Finding free slots...</Text>
              </View>
            )}

            {/* Available time slots */}
            {!loadingSlots && selectedScheduleDate && availableSlots.length > 0 && (
              <ScrollView style={{ maxHeight: 300 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 10 }}>
                  Available slots on {selectedScheduleDate.toLocaleDateString()}:
                </Text>
                {availableSlots.map((slot, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.button,
                      {
                        backgroundColor: '#10b981',
                        marginBottom: 8,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      },
                    ]}
                    onPress={() => handleScheduleTask(slot.start_time)}
                    disabled={scheduling}
                  >
                    <Text style={styles.buttonText}>
                      {slot.start_time} - {slot.end_time}
                    </Text>
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>
                      ({slot.duration_minutes} min)
                    </Text>
                  </TouchableOpacity>
                ))}
                
                {/* Show busy periods */}
                {busyPeriods.length > 0 && (
                  <>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 }}>
                      Busy times:
                    </Text>
                    {busyPeriods.map((busy, index) => (
                      <View
                        key={index}
                        style={{
                          backgroundColor: '#fef2f2',
                          borderLeftWidth: 3,
                          borderLeftColor: '#ef4444',
                          padding: 10,
                          marginBottom: 6,
                          borderRadius: 6,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#991b1b' }}>
                          {busy.start} - {busy.end}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#6b7280' }}>
                          {busy.title} ({busy.type})
                        </Text>
                      </View>
                    ))}
                  </>
                )}

                <TouchableOpacity
                  style={[styles.button, { backgroundColor: '#f59e0b', marginTop: 16 }]}
                  onPress={() => setCustomTimeMode(true)}
                >
                  <Text style={styles.buttonText}>Choose Custom Time</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* Custom Time Picker */}
            {!loadingSlots && selectedScheduleDate && customTimeMode && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 10, textAlign: 'center' }}>
                  Pick your own time:
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  {/* Hour Picker */}
                  <View style={{ flex: 1 }}>
                    <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                      {Array.from({ length: 24 }, (_, i) => i).map(hour => (
                        <TouchableOpacity
                          key={hour}
                          style={{
                            padding: 12,
                            backgroundColor: customTimeHour === hour ? '#6366f1' : 'transparent',
                            borderBottomWidth: 1,
                            borderBottomColor: '#e5e7eb',
                          }}
                          onPress={() => setCustomTimeHour(hour)}
                        >
                          <Text style={{ textAlign: 'center', color: customTimeHour === hour ? '#fff' : '#374151', fontWeight: customTimeHour === hour ? '600' : '400' }}>
                            {hour.toString().padStart(2, '0')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Hour</Text>
                  </View>

                  <Text style={{ fontSize: 20, color: '#6b7280' }}>:</Text>

                  {/* Minute Picker */}
                  <View style={{ flex: 1 }}>
                    <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                      {[0, 15, 30, 45].map(minute => (
                        <TouchableOpacity
                          key={minute}
                          style={{
                            padding: 12,
                            backgroundColor: customTimeMinute === minute ? '#6366f1' : 'transparent',
                            borderBottomWidth: 1,
                            borderBottomColor: '#e5e7eb',
                          }}
                          onPress={() => setCustomTimeMinute(minute)}
                        >
                          <Text style={{ textAlign: 'center', color: customTimeMinute === minute ? '#fff' : '#374151', fontWeight: customTimeMinute === minute ? '600' : '400' }}>
                            {minute.toString().padStart(2, '0')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 4 }}>Minute</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.button, styles.primaryButton]}
                  onPress={() => handleScheduleTask()}
                  disabled={scheduling}
                >
                  {scheduling ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>
                      Schedule at {String(customTimeHour).padStart(2, '0')}:{String(customTimeMinute).padStart(2, '0')}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, { backgroundColor: '#6b7280', marginTop: 8 }]}
                  onPress={() => setCustomTimeMode(false)}
                >
                  <Text style={styles.buttonText}>Back to Suggested Slots</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* No slots message */}
            {!loadingSlots && selectedScheduleDate && availableSlots.length === 0 && (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: '#6b7280', textAlign: 'center' }}>
                  No available slots found for this date. Try another day!
                </Text>
              </View>
            )}

            {/* Skip/Cancel button */}
            <TouchableOpacity
              style={[styles.button, { backgroundColor: '#6b7280', marginTop: 20 }]}
              onPress={handleSkipScheduling}
              disabled={scheduling}
            >
              <Text style={styles.buttonText}>Skip for Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ============================================================================
// AI CHAT SCREEN
// ============================================================================

const ChatScreen: React.FC<{ route?: any }> = ({ route }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkOnboarding();
  }, []);

  // Handle prefilled message from navigation
  useEffect(() => {
    if (route?.params?.prefillMessage) {
      setInputText(route.params.prefillMessage);
    }
  }, [route?.params?.prefillMessage]);

  const checkOnboarding = async () => {
    try {
      // Check if user has AI memory with onboarding completed
      const response = await api.get('/ai/memory/');
      const aiMemory = response.data;
      
      console.log('[CHAT] AI Memory:', aiMemory);
      
      if (aiMemory.onboarding_completed) {
        setOnboardingComplete(true);
        // Show normal welcome message
        setMessages([{
          id: '1',
          text: "Hey! I'm Clarity, your time awareness buddy. What's on your mind today? 😊",
          sender: 'ai',
          timestamp: new Date(),
        }]);
      } else {
        // Start onboarding
        startOnboarding();
      }
    } catch (error) {
      console.error('[CHAT] Error checking onboarding:', error);
      // Default to normal chat if error
      setMessages([{
        id: '1',
        text: "Hi! I'm Clarity, your time awareness assistant. How can I help you today?",
        sender: 'ai',
        timestamp: new Date(),
      }]);
      setOnboardingComplete(true);
    } finally {
      setLoading(false);
    }
  };

  const startOnboarding = () => {
    setMessages([{
      id: '1',
      text: "Hey there! 👋 I'm Clarity, and I'm here to help you get a better handle on time. Mind if I ask you a few quick questions so I can personalize things for you?",
      sender: 'ai',
      timestamp: new Date(),
    }]);
    setOnboardingStep(1);
  };

  const onboardingQuestions = [
    {
      question: "First up - how would you describe yourself when it comes to estimating how long tasks take? (Like, do you usually think something will take 30 mins but it ends up being 2 hours? 😅)",
      key: 'time_estimation_style'
    },
    {
      question: "Got it! And what's your biggest challenge with managing time? No judgment here - we all have our struggles!",
      key: 'biggest_challenge'
    },
    {
      question: "That makes sense! One more thing - when you're working on something, do you prefer short bursts of focus or longer stretches? ⚡",
      key: 'work_style'
    },
    {
      question: "Perfect! Last question - how do you like to communicate? Should I keep things casual like we're chatting, or would you prefer more formal and to-the-point? 🗣️",
      key: 'communication_preference'
    }
  ];

  const handleOnboardingResponse = async (response: string) => {
    const currentQuestion = onboardingQuestions[onboardingStep - 1];
    const newData = { ...onboardingData, [currentQuestion.key]: response };
    setOnboardingData(newData);

    if (onboardingStep < onboardingQuestions.length) {
      // Ask next question
      const nextQuestion = onboardingQuestions[onboardingStep];
      const aiMessage: ChatMessage = {
        id: Date.now().toString(),
        text: nextQuestion.question,
        sender: 'ai',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMessage]);
      setOnboardingStep(onboardingStep + 1);
    } else {
      // Onboarding complete!
      try {
        await api.post('/ai/onboarding/', { responses: newData });
        
        const completeMessage: ChatMessage = {
          id: Date.now().toString(),
          text: "Awesome! Thanks for sharing that with me. 🎯 I've got a much better sense of how to help you now. Feel free to ask me anything - I'm here to help with time estimates, breaking down tasks, or just chatting about how to tackle your to-do list!",
          sender: 'ai',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, completeMessage]);
        setOnboardingComplete(true);
      } catch (error) {
        console.error('[CHAT] Error saving onboarding:', error);
        setOnboardingComplete(true);
      }
    }
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: inputText,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageText = inputText;
    setInputText('');
    setSending(true);

    try {
      // If in onboarding, handle response differently
      if (!onboardingComplete && onboardingStep > 0) {
        await handleOnboardingResponse(messageText);
      } else {
        // Normal chat
        const response = await api.post('/chat/', {
          message: messageText,
        });

        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          text: response.data.response,
          sender: 'ai',
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, aiMessage]);
        
        // If tasks were created, show a notification
        if (response.data.tasks_created && response.data.tasks_created.length > 0) {
          const taskCount = response.data.tasks_created.length;
          const taskNames = response.data.tasks_created.map((t: any) => t.title).join(', ');
          
          // Show success notification
          setTimeout(() => {
            Alert.alert(
              '✅ Task Created!',
              `${taskCount > 1 ? `${taskCount} tasks` : 'Task'} added: ${taskNames}\n\nCheck your Tasks page to see ${taskCount > 1 ? 'them' : 'it'}!`,
              [{ text: 'OK' }]
            );
          }, 500);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: "Sorry, I'm having trouble connecting right now. Please try again!",
        sender: 'ai',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.chatContainer}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={[
              styles.messageBubble,
              item.sender === 'user' ? styles.userBubble : styles.aiBubble,
            ]}
          >
            <Text
              style={[
                styles.messageText,
                item.sender === 'user' ? styles.userText : styles.aiText,
              ]}
            >
              {item.text}
            </Text>
          </View>
        )}
        contentContainerStyle={styles.messagesList}
      />

      <View style={styles.chatInputContainer}>
        <TextInput
          style={styles.chatInput}
          placeholder="Ask Clarity anything..."
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, sending && styles.disabledButton]}
          onPress={handleSend}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendButtonText}>→</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ============================================================================
// PROFILE SCREEN
// ============================================================================

const ProfileScreen: React.FC = () => {
  const { user, logout } = React.useContext(AuthContext);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      console.log('Fetching profile with token:', api.defaults.headers.common['Authorization']);
      const response = await api.get('/profile/');
      setProfile(response.data);
      setAiSummary(response.data.ai_summary || null);
      console.log('[PROFILE] AI Summary:', response.data.ai_summary);
    } catch (error: any) {
      console.error('Error fetching profile:', error);
      console.error('Response status:', error.response?.status);
      if (error.response?.status === 401) {
        Alert.alert('Session Expired', 'Please login again');
        await logout();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const response = await api.get('/calendar/connect/');
      const authUrl = response.data.authorization_url;

      const result = await WebBrowser.openAuthSessionAsync(
        authUrl,
        'exp://localhost:8081'
      );

      if (result.type === 'success') {
        Alert.alert('Success', 'Google Calendar connected!');
        fetchProfile();
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to connect Google Calendar');
      console.error('Google connect error:', error);
    }
  };

  const handleLogout = () => {
    const confirmLogout = Platform.OS === 'web' 
      ? window.confirm('Are you sure you want to logout?')
      : true;
    
    if (Platform.OS === 'web' && confirmLogout) {
      console.log('[PROFILE] Web logout confirmed');
      performLogout();
    } else if (Platform.OS !== 'web') {
      Alert.alert(
        'Logout', 
        'Are you sure you want to logout?', 
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Logout',
            style: 'destructive',
            onPress: () => {
              console.log('[PROFILE] Native logout confirmed');
              performLogout();
            },
          },
        ]
      );
    }
  };

  const performLogout = async () => {
    try {
      console.log('[PROFILE] Starting logout...');
      setLoading(true);
      await logout();
      console.log('[PROFILE] Logout complete');
    } catch (error) {
      console.error('[PROFILE] Logout error:', error);
      Alert.alert('Error', 'Failed to logout. Please try again.');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      {/* User Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <Text style={styles.profileLabel}>Username</Text>
          <Text style={styles.profileValue}>{user?.username}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.profileLabel}>Email</Text>
          <Text style={styles.profileValue}>{user?.email || 'Not set'}</Text>
        </View>
      </View>

      {/* AI Insights - What AI Thinks About You */}
      {aiSummary && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🤖 What AI Thinks About You</Text>
          <View style={[styles.card, { backgroundColor: '#f0f9ff', borderLeftWidth: 4, borderLeftColor: '#6366f1' }]}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#6366f1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Your Productivity Profile
            </Text>
            <Text style={[styles.profileValue, { fontSize: 16, lineHeight: 24, color: '#1e3a8a', fontWeight: '500' }]}>
              {aiSummary}
            </Text>
            <Text style={{ fontSize: 12, color: '#60a5fa', marginTop: 12, fontStyle: 'italic' }}>
              💡 This insight is generated from your task patterns and updates daily
            </Text>
          </View>
        </View>
      )}

      {/* Show placeholder if no AI summary yet */}
      {!aiSummary && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🤖 What AI Thinks About You</Text>
          <View style={[styles.card, { backgroundColor: '#f9fafb', borderLeftWidth: 4, borderLeftColor: '#9ca3af' }]}>
            <Text style={{ fontSize: 15, lineHeight: 22, color: '#6b7280', textAlign: 'center', fontStyle: 'italic' }}>
              Complete a few tasks and I'll learn your patterns to provide personalized insights! 🎯
            </Text>
          </View>
        </View>
      )}

      {/* Google Calendar */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Integrations</Text>
        <View style={styles.card}>
          <Text style={styles.profileLabel}>Google Calendar</Text>
          <Text style={styles.profileValue}>
            {profile?.has_google_calendar ? '✅ Connected' : '❌ Not connected'}
          </Text>
          {!profile?.has_google_calendar && (
            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { marginTop: 10 }]}
              onPress={handleConnectGoogle}
            >
              <Text style={styles.buttonText}>Connect Google Calendar</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Logout */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.button, styles.dangerButton]}
          onPress={handleLogout}
        >
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// ============================================================================
// NAVIGATION
// ============================================================================

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const AuthStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Login" component={LoginScreen} />
    <Stack.Screen name="Register" component={RegisterScreen} />
  </Stack.Navigator>
);

const MainTabs = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarStyle: styles.tabBar,
      tabBarActiveTintColor: '#6366f1',
      tabBarInactiveTintColor: '#9ca3af',
    }}
  >
    <Tab.Screen
      name="Home"
      component={HomeScreen}
      options={{ tabBarLabel: '🏠 Home' }}
    />
    <Tab.Screen
      name="Calendar"
      component={CalendarScreen}
      options={{ tabBarLabel: '📅 Calendar' }}
    />
    <Tab.Screen
      name="Tasks"
      component={TasksScreen}
      options={{ tabBarLabel: '✓ Tasks' }}
    />
    <Tab.Screen
      name="Chat"
      component={ChatScreen}
      options={{ tabBarLabel: '💬 AI Chat' }}
    />
    <Tab.Screen
      name="Profile"
      component={ProfileScreen}
      options={{ tabBarLabel: '👤 Profile' }}
    />
  </Tab.Navigator>
);

// ============================================================================
// MAIN APP
// ============================================================================

export default function App() {
  return (
    <AuthProvider>
      <AuthContext.Consumer>
        {({ isAuthenticated, loading }) => {
          if (loading) {
            return (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={{ marginTop: 10 }}>Loading...</Text>
              </View>
            );
          }

          // Use key to force remount when auth state changes
          return isAuthenticated ? (
            <MainTabs key="main-tabs" />
          ) : (
            <AuthStack key="auth-stack" />
          );
        }}
      </AuthContext.Consumer>
      <StatusBar style="auto" />
    </AuthProvider>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  appTitle: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#6366f1',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    marginBottom: 48,
    textAlign: 'center',
  },
  authForm: {
    width: '100%',
    maxWidth: 400,
  },
  input: {
    height: 54,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  button: {
    height: 54,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#6366f1',
  },
  dangerButton: {
    backgroundColor: '#ef4444',
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkText: {
    color: '#6366f1',
    fontSize: 15,
  },
  header: {
    padding: 24,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 15,
    color: '#6b7280',
    marginTop: 6,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 15,
    color: '#6b7280',
  },
  cardDetail: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
  emptyContainer: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 22,
  },
  addTaskContainer: {
    flexDirection: 'row',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  addTaskButton: {
    margin: 20,
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  addTaskButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  taskInput: {
    flex: 1,
    height: 54,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginRight: 12,
  },
  addButton: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
  },
  tasksList: {
    flex: 1,
    padding: 20,
  },
  taskCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  taskCardDone: {
    opacity: 0.6,
  },
  taskCardContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
    lineHeight: 24,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: '#9ca3af',
  },
  taskMeta: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  taskMessage: {
    fontSize: 13,
    color: '#6366f1',
    fontStyle: 'italic',
    lineHeight: 19,
  },
  taskStatus: {
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  taskStatusText: {
    fontSize: 26,
  },
  deleteButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  deleteButtonText: {
    fontSize: 22,
  },
  subtasksContainer: {
    marginLeft: 24,
    marginTop: 8,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#d1d5db',
    paddingLeft: 12,
  },
  subtaskCardStyle: {
    backgroundColor: '#f9fafb',
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#9ca3af',
    padding: 14,
  },
  subtaskTitleStyle: {
    fontSize: 15,
    color: '#4b5563',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    width: '90%',
    maxWidth: 420,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 15,
    color: '#6b7280',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  feedbackButton: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    alignItems: 'center',
  },
  feedbackOnTime: {
    backgroundColor: '#10b981',
  },
  feedbackLittleLate: {
    backgroundColor: '#f59e0b',
  },
  feedbackVeryLate: {
    backgroundColor: '#ef4444',
  },
  feedbackButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalCancelButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCancelText: {
    color: '#6b7280',
    fontSize: 16,
  },
  // Clarity Breakdown Modal
  breakdownModalContent: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 20,
    padding: 24,
    maxHeight: '85%',
  },
  breakdownTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#6366f1',
    marginBottom: 8,
    textAlign: 'center',
  },
  breakdownMessage: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  breakdownReasoning: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  subtasksTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 15,
  },
  subtaskCard: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#6366f1',
  },
  subtaskNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#6366f1',
    marginRight: 10,
    marginTop: 2,
  },
  subtaskContent: {
    flex: 1,
  },
  subtaskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
    marginBottom: 6,
  },
  subtaskBullet: {
    fontSize: 20,
    color: '#6366f1',
    marginRight: 10,
    fontWeight: 'bold',
  },
  subtaskTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  subtaskDuration: {
    fontSize: 13,
    color: '#6366f1',
    fontWeight: '500',
  },
  subtaskDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  subtaskTime: {
    fontSize: 13,
    color: '#6366f1',
    fontWeight: '500',
  },
  totalTime: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1f2937',
    textAlign: 'center',
    marginTop: 10,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#f9fafb',
    paddingTop: 60,
  },
  messagesList: {
    padding: 20,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#6366f1',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  messageText: {
    fontSize: 15,
  },
  userText: {
    color: '#fff',
  },
  aiText: {
    color: '#111827',
  },
  chatInputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  chatInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    marginRight: 10,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  profileLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 5,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  profileValue: {
    fontSize: 16,
    color: '#111827',
  },
  tabBar: {
    height: 60,
    paddingBottom: 5,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
});