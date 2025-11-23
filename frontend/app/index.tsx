import React, { useState, useEffect, useContext } from 'react';
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
  KeyboardAvoidingView,
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
import { API_BASE_URL } from './config';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Configure axios
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // Increased to 30 seconds for slower connections
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

// Add response interceptor to handle 401 errors globally
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      console.log('[API] 401 Unauthorized - Token may be invalid, clearing auth data');
      // Clear stored auth data
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('user');
      // Note: The app will need to be reloaded to update auth state
    }
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
  priority?: 'low' | 'medium' | 'high' | null;
  status?: 'pending' | 'in_progress' | 'done' | 'overdue' | null;
  task_id?: number | null;
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
  register: (username: string, email: string, password: string, firstName?: string, lastName?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (userData: User) => Promise<void>;
  loading: boolean;
}

const AuthContext = React.createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  token: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  updateUser: async () => {},
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

  const register = async (username: string, email: string, password: string, firstName?: string, lastName?: string) => {
    try {
      console.log('[REGISTER] Attempting registration...');
      console.log('[REGISTER] API Base URL:', API_BASE_URL);
      const response = await api.post('/register/', {
        username,
        email,
        password,
        first_name: firstName || '',
        last_name: lastName || '',
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

  const updateUser = async (userData: User) => {
    try {
      setUser(userData);
      await AsyncStorage.setItem('user', JSON.stringify(userData));
      console.log('[AUTH] User updated:', userData);
    } catch (error) {
      console.error('[AUTH] Error updating user:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, user, token, login, register, logout, updateUser, loading }}
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
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <ScrollView 
        contentContainerStyle={styles.authScrollContainer}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.authContentWrapper}>
          <Text style={styles.appTitle}>Clarity</Text>
          <Text style={styles.subtitle}>Your AI Time Awareness Assistant</Text>

          <View style={styles.authForm}>
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor="#9ca3af"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const RegisterScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = React.useContext(AuthContext);

  const handleRegister = async () => {
    if (!username || !email || !password) {
      Alert.alert('Error', 'Please fill in all required fields (username, email, password)');
      return;
    }

    setLoading(true);
    try {
      await register(username, email, password, firstName, lastName);
    } catch (error: any) {
      Alert.alert('Registration Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <ScrollView 
        contentContainerStyle={styles.authScrollContainer}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.authContentWrapper}>
          <Text style={styles.appTitle}>Create Account</Text>

          <View style={styles.authForm}>
            <TextInput
              style={styles.input}
              placeholder="First Name (Optional)"
              placeholderTextColor="#9ca3af"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />
            <TextInput
              style={styles.input}
              placeholder="Last Name (Optional)"
              placeholderTextColor="#9ca3af"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
            />
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor="#9ca3af"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ============================================================================
// HOME SCREEN
// ============================================================================

const HomeScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user, isAuthenticated, token, logout } = React.useContext(AuthContext);
  const isFocused = useIsFocused();

  // Fetch data when authenticated
  useEffect(() => {
    if (isAuthenticated && token) {
      fetchData();
    }
  }, [isAuthenticated, token]);

  // Refresh when page is focused (navigating back to home)
  useEffect(() => {
    if (isFocused && isAuthenticated && token) {
      fetchData();
    }
  }, [isFocused]);

  // Auto-refresh every minute
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    
    const interval = setInterval(() => {
      fetchData();
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
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
      
      // Set all tasks
      setTasks(tasksResponse.data);
    } catch (error: any) {
      console.error('[HOME] Error fetching data:', error);
      
      // If auth error, clear auth and show alert
      if (error.response?.status === 401) {
        console.log('[HOME] Got 401 - Authentication failed');
        Alert.alert(
          'Session Expired',
          'Your session has expired. Please log in again.',
          [{ text: 'OK', onPress: () => logout() }]
        );
        setEvents([]);
        setTasks([]);
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

  // Get current week start (Sunday)
  const getWeekStart = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day;
    return new Date(now.setDate(diff));
  };

  // Calculate weekly statistics
  const getWeeklyStats = () => {
    const weekStart = getWeekStart();
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const weeklyTasks = tasks.filter(task => {
      const createdDate = new Date(task.created_at);
      return createdDate >= weekStart && createdDate < weekEnd;
    });

    const completedThisWeek = weeklyTasks.filter(t => t.status === 'done').length;
    const totalThisWeek = weeklyTasks.length;

    return { completedThisWeek, totalThisWeek };
  };

  // Get today's statistics
  const getTodayStats = () => {
    const today = new Date();
    const todayStr = formatDate(today);

    console.log('[HOME STATS] Today:', todayStr);
    console.log('[HOME STATS] Total tasks:', tasks.length);

    // Filter tasks completed today (check completed_at date)
    const completedToday = tasks.filter(task => {
      if (task.status !== 'done') return false;
      
      // Check if completed_at exists and is today
      if (task.completed_at) {
        const completedDate = new Date(task.completed_at);
        const completedDateStr = formatDate(completedDate);
        const isToday = completedDateStr === todayStr;
        if (isToday) {
          console.log('[HOME STATS] Task completed today:', task.title, 'at', task.completed_at);
        }
        return isToday;
      }
      
      // Fallback: if no completed_at but status is done, check updated_at
      if (task.updated_at) {
        const updatedDate = new Date(task.updated_at);
        const updatedDateStr = formatDate(updatedDate);
        const isToday = updatedDateStr === todayStr;
        if (isToday) {
          console.log('[HOME STATS] Task marked done today (via updated_at):', task.title);
        }
        return isToday;
      }
      
      return false;
    });

    const completedCount = completedToday.length;
    console.log('[HOME STATS] Completed today count:', completedCount);
    
    // Calculate focus time (sum of completed task durations today)
    const focusTimeMinutes = completedToday.reduce((sum, t) => sum + t.estimated_duration_minutes, 0);
    console.log('[HOME STATS] Focus time minutes:', focusTimeMinutes);
    
    // Get today's events from calendar (unique events only)
    const todayEvents = events.filter(event => {
      const eventDate = new Date(event.start);
      const eventDateStr = formatDate(eventDate);
      return eventDateStr === todayStr;
    });

    // Get today's scheduled tasks that have calendar events
    const todayScheduledTasksWithEvents = tasks.filter(task => {
      return task.scheduled_date === todayStr && task.calendar_event_id;
    });

    // Count events, but don't double count tasks that are already calendar events
    const eventCount = todayEvents.length;
    
    console.log('[HOME STATS] Calendar events today:', eventCount);
    console.log('[HOME STATS] Tasks with calendar events:', todayScheduledTasksWithEvents.length);

    return {
      completedToday: completedCount,
      focusTimeHours: focusTimeMinutes / 60,
      eventsToday: eventCount
    };
  };

  // Get today's focus tasks (scheduled for today or high priority)
  const getTodayFocusTasks = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = formatDate(today);

    return tasks
      .filter(task => {
        if (task.status === 'done') return false;
        
        // Include if scheduled for today
        if (task.scheduled_date === todayStr) return true;
        
        // Include high priority tasks that aren't scheduled for future dates
        if (task.priority === 'high' && !task.scheduled_date) return true;
        
        return false;
      })
      .sort((a, b) => {
        // Sort by priority first
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const aPriority = priorityOrder[a.priority || 'medium'];
        const bPriority = priorityOrder[b.priority || 'medium'];
        
        if (aPriority !== bPriority) return aPriority - bPriority;
        
        // Then by scheduled time
        if (a.scheduled_time && b.scheduled_time) {
          return a.scheduled_time.localeCompare(b.scheduled_time);
        }
        if (a.scheduled_time) return -1;
        if (b.scheduled_time) return 1;
        
        return 0;
      })
      .slice(0, 5);
  };

  // Format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const weeklyStats = getWeeklyStats();
  const todayStats = getTodayStats();
  const focusTasks = getTodayFocusTasks();
  const progressPercentage = weeklyStats.totalThisWeek > 0 
    ? (weeklyStats.completedThisWeek / weeklyStats.totalThisWeek) * 100 
    : 0;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Welcome Header */}
      <View style={styles.welcomeHeader}>
        <Text style={styles.welcomeTitle}>Welcome back, {user?.first_name || user?.username}! 👋</Text>
        <Text style={styles.welcomeSubtitle}>Here's your productivity at a glance</Text>
      </View>

      {/* Weekly Progress Section */}
      <View style={styles.homeSection}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressIcon}>📈</Text>
          <Text style={styles.progressTitle}>Weekly Progress</Text>
        </View>
        
        <Text style={styles.progressLabel}>Tasks completed this week</Text>
        <Text style={styles.progressCount}>{weeklyStats.completedThisWeek} / {weeklyStats.totalThisWeek}</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBarFill, { width: `${progressPercentage}%` }]} />
        </View>
        
        <Text style={styles.progressMessage}>
          {weeklyStats.completedThisWeek > 0 
            ? "You're making great progress! Keep up the momentum." 
            : "Let's get started on some tasks this week!"}
        </Text>
      </View>

      {/* Statistics Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <View style={styles.statIconContainer}>
            <Text style={styles.statIcon}>✓</Text>
          </View>
          <Text style={styles.statLabel}>Completed Today</Text>
          <Text style={styles.statValue}>{todayStats.completedToday}</Text>
        </View>

        <View style={styles.statCard}>
          <View style={[styles.statIconContainer, { backgroundColor: '#DBEAFE' }]}>
            <Text style={styles.statIcon}>⏱️</Text>
          </View>
          <Text style={styles.statLabel}>Focus Time</Text>
          <Text style={styles.statValue}>{todayStats.focusTimeHours.toFixed(1)}h</Text>
        </View>

        <View style={styles.statCard}>
          <View style={[styles.statIconContainer, { backgroundColor: '#FEF3C7' }]}>
            <Text style={styles.statIcon}>📅</Text>
          </View>
          <Text style={styles.statLabel}>Events Today</Text>
          <Text style={styles.statValue}>{todayStats.eventsToday}</Text>
        </View>
      </View>

      {/* Today's Focus Section */}
      <View style={styles.homeSection}>
        <View style={styles.focusHeader}>
          <View>
            <Text style={styles.focusIcon}>✨</Text>
            <Text style={styles.focusTitle}>Today's Focus</Text>
          </View>
          <TouchableOpacity 
            onPress={() => navigation?.navigate('Tasks')}
            style={styles.viewAllButton}
          >
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>

        {focusTasks.length === 0 ? (
          <View style={styles.emptyFocusCard}>
            <Text style={styles.emptyFocusText}>No tasks due today. You're all caught up! 🎉</Text>
          </View>
        ) : (
          focusTasks.map(task => {
            const priorityColor = task.priority ? PRIORITY_COLORS[task.priority] : PRIORITY_COLORS.medium;
            const timeStr = task.scheduled_time 
              ? task.scheduled_time.substring(0, 5)
              : '';

            return (
              <TouchableOpacity
                key={task.id}
                style={[styles.focusCard, { borderLeftColor: priorityColor }]}
                onPress={() => navigation?.navigate('Tasks')}
              >
                <View style={styles.focusCardContent}>
                  <Text style={styles.focusTaskTitle}>{task.title}</Text>
                  <View style={styles.focusTaskMeta}>
                    {timeStr && (
                      <Text style={styles.focusTaskTime}>⏰ {timeStr}</Text>
                    )}
                    <Text style={styles.focusTaskDuration}>
                      ⏱️ {formatDuration(task.estimated_duration_minutes)}
                    </Text>
                    {task.location && (
                      <Text style={styles.focusTaskLocation} numberOfLines={1}>
                        📍 {task.location}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={[styles.priorityBadge, { backgroundColor: priorityColor }]}>
                  <Text style={styles.priorityBadgeText}>
                    {task.priority?.toUpperCase() || 'MED'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Need Help Planning Section */}
      <View style={styles.helpSection}>
        <Text style={styles.helpTitle}>Need help planning your day?</Text>
        <Text style={styles.helpSubtitle}>Ask Clarity to break down tasks or schedule your activities</Text>
        <TouchableOpacity
          style={styles.chatButton}
          onPress={() => navigation?.navigate('Chat')}
        >
          <Text style={styles.chatButtonText}>Chat with Clarity</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// ============================================================================
// CALENDAR SCREEN
// ============================================================================

const CalendarScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addTaskModalVisible, setAddTaskModalVisible] = useState(false);
  const [calendarView, setCalendarView] = useState<'daily' | '3day' | 'weekly' | 'monthly'>('weekly');
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day; // Start on Sunday
    return new Date(now.setDate(diff));
  });
  const [currentDate, setCurrentDate] = useState(new Date());
  const isFocused = useIsFocused();

  // Load calendar view preference
  useEffect(() => {
    const loadViewPreference = async () => {
      try {
        const savedView = await AsyncStorage.getItem('calendarView');
        if (savedView && ['daily', '3day', 'weekly', 'monthly'].includes(savedView)) {
          setCalendarView(savedView as any);
        }
      } catch (error) {
        console.error('Error loading calendar view preference:', error);
      }
    };
    loadViewPreference();
  }, []);

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

  const handleViewChange = async (view: 'daily' | '3day' | 'weekly' | 'monthly') => {
    setCalendarView(view);
    try {
      await AsyncStorage.setItem('calendarView', view);
    } catch (error) {
      console.error('Error saving calendar view preference:', error);
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

  const getDaysForView = () => {
    const days = [];
    
    if (calendarView === 'monthly') {
      // Get all days in the month
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDay = firstDay.getDay(); // Day of week (0 = Sunday)
      
      // Add previous month's days to fill the first week
      for (let i = startDay - 1; i >= 0; i--) {
        const day = new Date(firstDay);
        day.setDate(day.getDate() - (i + 1));
        days.push(day);
      }
      
      // Add all days in current month
      for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push(new Date(year, month, i));
      }
      
      // Add next month's days to complete the grid (6 weeks)
      const remainingDays = 42 - days.length; // 6 rows × 7 days
      for (let i = 1; i <= remainingDays; i++) {
        const day = new Date(lastDay);
        day.setDate(day.getDate() + i);
        days.push(day);
      }
    } else if (calendarView === '3day') {
      // Yesterday, Today, Tomorrow
      const yesterday = new Date(currentDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const today = new Date(currentDate);
      const tomorrow = new Date(currentDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      days.push(yesterday, today, tomorrow);
    } else if (calendarView === 'weekly') {
      // Week view (Sunday to Saturday)
      for (let i = 0; i < 7; i++) {
        const day = new Date(currentWeekStart);
        day.setDate(currentWeekStart.getDate() + i);
        days.push(day);
      }
    } else {
      // Daily view
      days.push(new Date(currentDate));
    }
    
    return days;
  };

  const navigateView = (direction: 'prev' | 'next') => {
    if (calendarView === 'weekly') {
      const newStart = new Date(currentWeekStart);
      newStart.setDate(newStart.getDate() + (direction === 'next' ? 7 : -7));
      setCurrentWeekStart(newStart);
    } else if (calendarView === 'monthly') {
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
      setCurrentDate(newDate);
    } else {
      const newDate = new Date(currentDate);
      const increment = calendarView === 'daily' ? 1 : 3;
      newDate.setDate(newDate.getDate() + (direction === 'next' ? increment : -increment));
      setCurrentDate(newDate);
    }
  };

  const getViewTitle = () => {
    if (calendarView === 'monthly') {
      return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else if (calendarView === 'weekly') {
      const weekDays = getWeekDays();
      const start = currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const end = weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${start} - ${end}`;
    } else if (calendarView === '3day') {
      const yesterday = new Date(currentDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(currentDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const start = yesterday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const end = tomorrow.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${start} - ${end}`;
    } else {
      return currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
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



  const goToToday = () => {
    const now = new Date();
    setCurrentDate(now);
    if (calendarView === 'weekly') {
      const day = now.getDay();
      const diff = now.getDate() - day;
      setCurrentWeekStart(new Date(now.setDate(diff)));
    }
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

  const daysToShow = getDaysForView();

  return (
    <View style={styles.container}>
      {/* Calendar Header */}
      <View style={styles.calendarHeader}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
          <Text style={styles.calendarHeaderTitle}>Calendar 📅</Text>
          <Text style={styles.calendarHeaderSubtitle}>Your schedule at a glance</Text>
        </View>
        
        {/* View Selector */}
        <View style={styles.viewSelector}>
          <TouchableOpacity 
            style={[styles.viewButton, calendarView === 'daily' && styles.viewButtonActive]}
            onPress={() => handleViewChange('daily')}
          >
            <Text style={[styles.viewButtonText, calendarView === 'daily' && styles.viewButtonTextActive]}>Day</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.viewButton, calendarView === '3day' && styles.viewButtonActive]}
            onPress={() => handleViewChange('3day')}
          >
            <Text style={[styles.viewButtonText, calendarView === '3day' && styles.viewButtonTextActive]}>3 Day</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.viewButton, calendarView === 'weekly' && styles.viewButtonActive]}
            onPress={() => handleViewChange('weekly')}
          >
            <Text style={[styles.viewButtonText, calendarView === 'weekly' && styles.viewButtonTextActive]}>Week</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.viewButton, calendarView === 'monthly' && styles.viewButtonActive]}
            onPress={() => handleViewChange('monthly')}
          >
            <Text style={[styles.viewButtonText, calendarView === 'monthly' && styles.viewButtonTextActive]}>Month</Text>
          </TouchableOpacity>
        </View>
        
        {/* Date Navigation */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 15 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => navigateView('prev')} style={{ padding: 10 }}>
              <Text style={{ color: '#fff', fontSize: 24 }}>‹</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{getViewTitle()}</Text>
              <TouchableOpacity onPress={goToToday}>
                <Text style={{ color: '#cbd5e1', fontSize: 13, marginTop: 3 }}>Today</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => navigateView('next')} style={{ padding: 10 }}>
              <Text style={{ color: '#fff', fontSize: 24 }}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Calendar View Grid */}
      {calendarView === 'monthly' ? (
        // Monthly Grid View
        <ScrollView 
          style={{ flex: 1, backgroundColor: '#fff' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEvents(); }} />}
        >
          {/* Weekday Headers */}
          <View style={styles.monthWeekdayHeader}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
              <View key={idx} style={styles.monthWeekdayCell}>
                <Text style={styles.monthWeekdayText}>{day}</Text>
              </View>
            ))}
          </View>
          
          {/* Month Grid */}
          <View style={styles.monthGrid}>
            {daysToShow.map((day, index) => {
              const dayEvents = getEventsForDay(day);
              const isCurrentMonth = day.getMonth() === currentDate.getMonth();
              const isTodayDate = isToday(day);
              
              return (
                <TouchableOpacity
                  key={index}
                  style={styles.monthDayCell}
                  onPress={() => {
                    setCurrentDate(day);
                    handleViewChange('daily');
                  }}
                >
                  <View style={[
                    styles.monthDayNumber,
                    isTodayDate && styles.monthDayNumberToday,
                  ]}>
                    <Text style={[
                      styles.monthDayText,
                      !isCurrentMonth && styles.monthDayTextOther,
                      isTodayDate && styles.monthDayTextToday,
                    ]}>
                      {day.getDate()}
                    </Text>
                  </View>
                  <View style={styles.monthEventDots}>
                    {dayEvents.slice(0, 3).map((event, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.monthEventDot,
                          { backgroundColor: event.color || '#6366f1' },
                        ]}
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <Text style={styles.monthEventMore}>+{dayEvents.length - 3}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        // Day/3-Day/Week Timeline View (Google Calendar Style)
        <ScrollView 
          style={{ flex: 1, backgroundColor: '#fff' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEvents(); }} />}
        >
          {/* Day Headers */}
          <View style={styles.dayHeadersRow}>
            <View style={{ width: 50 }} />
            {daysToShow.map((day, index) => {
              const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
              const dayNum = day.getDate();
              const isTodayDate = isToday(day);
              
              return (
                <View key={index} style={styles.dayHeader}>
                  <Text style={[styles.dayHeaderWeekday, isTodayDate && styles.dayHeaderWeekdayToday]}>
                    {dayName}
                  </Text>
                  <View style={[styles.dayHeaderNumber, isTodayDate && styles.dayHeaderNumberToday]}>
                    <Text style={[styles.dayHeaderNumberText, isTodayDate && styles.dayHeaderNumberTextToday]}>
                      {dayNum}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          
          {/* Timeline Grid with Time Column */}
          <View style={{ flexDirection: 'row' }}>
            {/* Time Column */}
            <View style={styles.timeColumn}>
              {Array.from({ length: 24 }, (_, hour) => (
                <View key={hour} style={styles.timeSlot}>
                  <Text style={styles.timeLabel}>
                    {hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}
                  </Text>
                </View>
              ))}
            </View>
            
            {/* Days Grid */}
            <View style={{ flex: 1, flexDirection: 'row' }}>
              {daysToShow.map((day, dayIndex) => (
                <View key={dayIndex} style={styles.dayColumn}>
                  {/* Hour Rows */}
                  {Array.from({ length: 24 }, (_, hour) => (
                    <View key={hour} style={styles.hourRow}>
                      <View style={styles.hourLine} />
                    </View>
                  ))}
                  
                  {/* Events positioned absolutely */}
                  <View style={styles.eventsContainer}>
                    {getEventsForDay(day).map((event, idx) => {
                      const startDate = new Date(event.start);
                      const endDate = new Date(event.end);
                      const startHour = startDate.getHours() + startDate.getMinutes() / 60;
                      const endHour = endDate.getHours() + endDate.getMinutes() / 60;
                      const duration = endHour - startHour;
                      const top = startHour * 60; // 60px per hour
                      const height = Math.max(duration * 60, 30); // minimum 30px
                      
                      const priorityColor = event.priority ? PRIORITY_COLORS[event.priority] : null;
                      const isCompleted = event.status === 'done';
                      
                      return (
                        <TouchableOpacity
                          key={idx}
                          onPress={() => {
                            if (event.task_id && navigation) {
                              navigation.navigate('Tasks', { scrollToTaskId: event.task_id });
                            }
                          }}
                          onLongPress={() => handleDeleteEvent(event.id)}
                          style={[
                            styles.timelineEvent,
                            {
                              top,
                              height,
                              backgroundColor: event.color || '#6366f1',
                              borderLeftWidth: priorityColor ? 4 : 0,
                              borderLeftColor: priorityColor || 'transparent',
                              opacity: isCompleted ? 0.6 : 1,
                            },
                          ]}
                        >
                          <Text style={[
                            styles.timelineEventTitle,
                            { textDecorationLine: isCompleted ? 'line-through' : 'none' },
                          ]}>
                            {event.title}
                          </Text>
                          <Text style={[
                            styles.timelineEventTime,
                            { textDecorationLine: isCompleted ? 'line-through' : 'none' },
                          ]}>
                            {startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </Text>
                          {event.location && height > 50 && (
                            <Text style={[
                              styles.timelineEventLocation,
                              { textDecorationLine: isCompleted ? 'line-through' : 'none' },
                            ]}>
                              📍 {event.location}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

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
        onPress={() => setAddTaskModalVisible(true)}
      >
        <Text style={{ color: '#fff', fontSize: 28, fontWeight: '300' }}>+</Text>
      </TouchableOpacity>

      {/* Add Task Modal */}
      <AddTaskModal
        visible={addTaskModalVisible}
        onClose={() => setAddTaskModalVisible(false)}
        onTaskCreated={() => {
          setAddTaskModalVisible(false);
          fetchEvents(); // Refresh calendar after task creation
        }}
      />
    </View>
  );
};

// ============================================================================
// TASKS SCREEN
// ============================================================================

const TasksScreen: React.FC<{ navigation?: any; route?: any }> = ({ navigation, route }) => {
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
  const taskScrollViewRef = React.useRef<ScrollView>(null);
  const taskRefs = React.useRef<{ [key: number]: View | null }>({});
  
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

  // Handle navigation from calendar - scroll to specific task
  useEffect(() => {
    if (route?.params?.scrollToTaskId && tasks.length > 0) {
      const taskId = route.params.scrollToTaskId;
      
      // Find the task and its scheduled date
      const task = tasks.find(t => t.id === taskId);
      if (task && task.scheduled_date) {
        // Parse date string to avoid timezone issues
        // scheduled_date is in format "YYYY-MM-DD"
        const [year, month, day] = task.scheduled_date.split('-').map(Number);
        const taskDate = new Date(year, month - 1, day); // month is 0-indexed
        setSelectedDate(taskDate);
      }
      
      // Expand the task
      setExpandedTasks(new Set([taskId]));
      
      // Scroll to the task after a short delay to ensure render is complete
      setTimeout(() => {
        const taskRef = taskRefs.current[taskId];
        if (taskRef && taskScrollViewRef.current) {
          taskRef.measureLayout(
            taskScrollViewRef.current as any,
            (x, y) => {
              taskScrollViewRef.current?.scrollTo({ y: y - 100, animated: true });
            },
            () => {}
          );
        }
      }, 500);
      
      // Clear the navigation param
      if (route.params) {
        route.params.scrollToTaskId = undefined;
      }
    }
  }, [route?.params?.scrollToTaskId, tasks]);

  // Update current time every minute for "Active" status
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  // Sync scheduled tasks to calendar events every minute
  useEffect(() => {
    const syncTasksToCalendar = async () => {
      try {
        const scheduledTasks = tasks.filter(task => 
          task.scheduled_date && 
          task.scheduled_time && 
          task.status !== 'done' &&
          !task.calendar_event_id
        );

        if (scheduledTasks.length === 0) return;

        console.log(`📅 Syncing ${scheduledTasks.length} scheduled tasks to calendar...`);

        for (const task of scheduledTasks) {
          try {
            // Create calendar event for this task
            const eventData = {
              task_id: task.id,
              date: task.scheduled_date,
              time: task.scheduled_time,
            };

            await api.post('/tasks/schedule/', eventData);
            console.log(`✅ Synced task "${task.title}" to calendar`);
          } catch (error) {
            console.error(`❌ Failed to sync task "${task.title}":`, error);
          }
        }

        // Refresh tasks to get updated calendar_event_id values
        await fetchTasks();
      } catch (error) {
        console.error('Error syncing tasks to calendar:', error);
      }
    };

    // Run sync immediately
    syncTasksToCalendar();

    // Then run every minute
    const timer = setInterval(syncTasksToCalendar, 60000);
    return () => clearInterval(timer);
  }, [tasks]);

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
    console.log('🔍 Filtering tasks for date:', selectedDateStr, 'Tab:', activeTab);
    
    return tasks.filter(task => {
      // Always show unscheduled tasks
      if (!task.scheduled_date) {
        return activeTab === 'active' ? task.status !== 'done' : task.status === 'done';
      }
      
      // Show tasks scheduled for selected date
      if (task.scheduled_date === selectedDateStr) {
        const matches = activeTab === 'active' ? task.status !== 'done' : task.status === 'done';
        if (matches) {
          console.log('✅ Task matches filter:', task.title, 'scheduled_date:', task.scheduled_date, 'status:', task.status);
        }
        return matches;
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
      console.log('📥 Fetched tasks:', response.data.length, 'tasks');
      console.log('📅 Tasks with scheduling:', response.data.filter((t: Task) => t.scheduled_date).map((t: Task) => ({ 
        title: t.title, 
        scheduled_date: t.scheduled_date, 
        scheduled_time: t.scheduled_time 
      })));
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
      <View 
        key={task.id}
        ref={(ref) => {
          if (!isSubtask) {
            taskRefs.current[task.id] = ref;
          }
        }}
      >
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
                            referencedTask: task
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
                

              </View>
            </View>
          </TouchableOpacity>
          
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Checkbox for completing/uncompleting task */}
            <TouchableOpacity
              onPress={() => {
                if (task.status === 'done') {
                  handleMarkIncomplete(task);
                } else {
                  setSelectedTask(task);
                  setFeedbackModalVisible(true);
                }
              }}
              style={styles.checkboxButton}
            >
              <Text style={styles.checkboxIcon}>
                {task.status === 'done' ? '☑️' : '⬜'}
              </Text>
            </TouchableOpacity>
            
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
            {[...task.subtasks]
              .sort((a, b) => (a.order || 0) - (b.order || 0))
              .map((subtask, index) => {
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
      {/* Tasks Header */}
      <View style={styles.tasksHeader}>
        <Text style={styles.tasksHeaderTitle}>Your Tasks ✓</Text>
        <Text style={styles.tasksHeaderSubtitle}>AI-powered time estimates</Text>
      </View>

      {/* Date Navigation */}
      <View style={styles.dateNavigation}>
        <View style={styles.dateNavRow}>
          <TouchableOpacity
            onPress={goToPreviousDay}
            style={styles.dateNavButton}
          >
            <Text style={styles.dateNavArrow}>←</Text>
          </TouchableOpacity>
          
          <View style={styles.dateNavCenter}>
            <Text style={styles.dateNavDate}>
              {isToday(selectedDate) ? 'Today' : selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={styles.dateNavDay}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}
            </Text>
          </View>
          
          <TouchableOpacity
            onPress={goToNextDay}
            style={styles.dateNavButton}
          >
            <Text style={styles.dateNavArrow}>→</Text>
          </TouchableOpacity>
        </View>
        
        {!isToday(selectedDate) && (
          <TouchableOpacity
            onPress={goToToday}
            style={styles.todayButton}
          >
            <Text style={styles.todayButtonText}>Go to Today</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Active/Completed Tabs */}
      <View style={styles.taskTabs}>
        <TouchableOpacity
          onPress={() => setActiveTab('active')}
          style={[styles.taskTab, activeTab === 'active' && styles.taskTabActive]}
        >
          <Text style={[styles.taskTabText, activeTab === 'active' && styles.taskTabTextActive]}>
            Active ({getFilteredTasks().filter(t => t.status !== 'done').length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('completed')}
          style={[styles.taskTab, activeTab === 'completed' && styles.taskTabActive]}
        >
          <Text style={[styles.taskTabText, activeTab === 'completed' && styles.taskTabTextActive]}>
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
      <ScrollView 
        ref={taskScrollViewRef}
        style={styles.tasksList}
      >
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
  const [referencedTask, setReferencedTask] = useState<Task | null>(null);
  const flatListRef = React.useRef<any>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  useEffect(() => {
    checkOnboarding();
  }, []);

  // Handle task reference from navigation
  useEffect(() => {
    if (route?.params?.referencedTask) {
      setReferencedTask(route.params.referencedTask);
      // Clear the param after setting it
      if (route.params) {
        route.params.referencedTask = undefined;
      }
    }
  }, [route?.params?.referencedTask]);

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
    
    // Store task reference before clearing
    const taskRef = referencedTask;
    setReferencedTask(null); // Clear reference after sending
    
    setSending(true);

    try {
      // If in onboarding, handle response differently
      if (!onboardingComplete && onboardingStep > 0) {
        await handleOnboardingResponse(messageText);
      } else {
        // Build message with task context if referenced
        let fullMessage = messageText;
        if (taskRef) {
          const taskContext = `[Editing task: "${taskRef.title}". Current details - Scheduled: ${taskRef.scheduled_date || 'not scheduled'} at ${taskRef.scheduled_time?.substring(0, 5) || 'no time'}. Duration: ${formatDuration(taskRef.estimated_duration_minutes)}. Priority: ${taskRef.priority || 'medium'}. Location: ${taskRef.location || 'none'}. ${taskRef.subtasks && taskRef.subtasks.length > 0 ? `Has ${taskRef.subtasks.length} subtasks.` : ''}] User message: ${messageText}`;
          fullMessage = taskContext;
        }
        
        // Normal chat
        const response = await api.post('/chat/', {
          message: fullMessage,
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
    <KeyboardAvoidingView 
      style={styles.chatContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Chat Header */}
      <View style={styles.chatHeader}>
        <Text style={styles.chatHeaderTitle}>Chat with Clarity 💬</Text>
        <Text style={styles.chatHeaderSubtitle}>Your AI time awareness assistant</Text>
      </View>

      <FlatList
        ref={flatListRef}
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
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Referenced Task Bar */}
      {referencedTask && (
        <View style={styles.referenceBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.referenceLabel}>Task:</Text>
            <Text style={styles.referenceTaskName}>{referencedTask.title}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setReferencedTask(null)}
            style={styles.referenceCloseButton}
          >
            <Text style={styles.referenceCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.chatInputContainer}>
        <TextInput
          style={styles.chatInput}
          placeholder="Ask Clarity anything..."
          placeholderTextColor="#9ca3af"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          blurOnSubmit={false}
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
    </KeyboardAvoidingView>
  );
};

// ============================================================================
// PROFILE SCREEN
// ============================================================================

const ProfileScreen: React.FC = () => {
  const { user, logout, updateUser } = React.useContext(AuthContext);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<any>({});
  const [editingPreferences, setEditingPreferences] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editedUsername, setEditedUsername] = useState('');
  const [editedFirstName, setEditedFirstName] = useState('');
  const [editedLastName, setEditedLastName] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [refreshingMotivation, setRefreshingMotivation] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const refreshMotivation = async () => {
    setRefreshingMotivation(true);
    try {
      const response = await api.get('/profile/');
      setAiSummary(response.data.ai_summary || null);
      console.log('[PROFILE] Refreshed AI Summary:', response.data.ai_summary);
    } catch (error: any) {
      console.error('Error refreshing motivation:', error);
      Alert.alert('Error', 'Failed to refresh motivation');
    } finally {
      setRefreshingMotivation(false);
    }
  };

  const fetchProfile = async () => {
    try {
      console.log('Fetching profile with token:', api.defaults.headers.common['Authorization']);
      const response = await api.get('/profile/');
      setProfile(response.data);
      setAiSummary(response.data.ai_summary || null);
      console.log('[PROFILE] AI Summary:', response.data.ai_summary);
      
      // Initialize edit fields
      setEditedUsername(response.data.user.username);
      setEditedFirstName(response.data.user.first_name || '');
      setEditedLastName(response.data.user.last_name || '');
      setProfileImage(response.data.user.profile_image || null);
      
      // Load preferences from AI memory
      if (response.data.ai_memory && response.data.ai_memory.onboarding_data) {
        setPreferences(response.data.ai_memory.onboarding_data);
      }
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

  const handleSavePreferences = async () => {
    setSavingPreferences(true);
    try {
      await api.post('/ai/onboarding/', { 
        responses: preferences,
        onboarding_completed: true 
      });
      Alert.alert('Success', 'Preferences updated!');
      setEditingPreferences(false);
    } catch (error) {
      console.error('[PROFILE] Error saving preferences:', error);
      Alert.alert('Error', 'Failed to save preferences');
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!editedUsername.trim()) {
      Alert.alert('Error', 'Username cannot be empty');
      return;
    }

    setSavingPreferences(true);
    try {
      const response = await api.patch('/profile/update/', {
        username: editedUsername,
        first_name: editedFirstName,
        last_name: editedLastName,
      });
      
      // Update the user context with new data
      await updateUser(response.data.user);
      
      Alert.alert('Success', 'Profile updated!');
      setEditingProfile(false);
      await fetchProfile(); // Refresh profile data
    } catch (error: any) {
      console.error('[PROFILE] Error saving profile:', error);
      if (error.response?.status === 400 && error.response?.data?.error?.includes('username')) {
        Alert.alert('Error', 'Username is already taken. Please choose another.');
      } else {
        Alert.alert('Error', 'Failed to update profile');
      }
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleSelectImage = () => {
    Alert.alert(
      'Profile Picture',
      'Choose an option',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Choose from Library',
          onPress: () => Alert.alert('Coming Soon', 'Image upload will be available in the next update!')
        },
        {
          text: 'Take Photo',
          onPress: () => Alert.alert('Coming Soon', 'Camera feature will be available in the next update!')
        }
      ]
    );
  };

  const getPreferenceLabel = (key: string, value: string): string => {
    const labels: any = {
      work_rhythm: {
        early_bird: "Early Bird (5am-9am)",
        morning_person: "Morning Person (9am-12pm)",
        afternoon_warrior: "Afternoon Warrior (12pm-5pm)",
        night_owl: "Night Owl (9pm-2am)"
      },
      break_preference: {
        short_frequent: "Short & Sweet (5-10 min/hour)",
        medium: "Balanced (15-20 min/2 hours)",
        long_rare: "Long & Deep (30+ min)",
        no_schedule: "Go with the flow"
      },
      work_style: {
        sprint: "Quick Sprints (20-30 min)",
        standard: "Standard Blocks (45-60 min)",
        deep_dive: "Deep Dive (90+ min)",
        flexible: "Mix it up"
      },
      planning_style: {
        detailed: "Every minute planned",
        rough_outline: "Rough outline",
        priorities: "Just priorities",
        spontaneous: "Wing it"
      }
    };
    return labels[key]?.[value] || value;
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
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <Text style={styles.profileHeaderTitle}>Your Profile 👤</Text>
        <Text style={styles.profileHeaderSubtitle}>Manage your account and preferences</Text>
      </View>

      {/* Profile Picture & Info Section */}
      <View style={styles.profileSection}>
        <View style={styles.profileCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            {/* Profile Picture */}
            <TouchableOpacity 
              onPress={handleSelectImage}
              style={styles.profileImageContainer}
            >
              {profileImage ? (
                <Text style={styles.profileImagePlaceholder}>📷</Text>
              ) : (
                <Text style={styles.profileImagePlaceholder}>👤</Text>
              )}
              <View style={styles.profileImageBadge}>
                <Text style={styles.profileImageBadgeText}>✏️</Text>
              </View>
            </TouchableOpacity>

            {/* Name & Email */}
            <View style={{ flex: 1, marginLeft: 16 }}>
              {!editingProfile ? (
                <>
                  <Text style={styles.profileDisplayName}>
                    {user?.first_name && user?.last_name 
                      ? `${user.first_name} ${user.last_name}`
                      : user?.username}
                  </Text>
                  <Text style={styles.profileDisplayEmail}>{user?.email || 'No email set'}</Text>
                  <TouchableOpacity 
                    onPress={() => setEditingProfile(true)}
                    style={{ marginTop: 8 }}
                  >
                    <Text style={{ color: '#6366f1', fontSize: 14, fontWeight: '600' }}>✏️ Edit Profile</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TextInput
                    style={styles.profileEditInput}
                    value={editedFirstName}
                    onChangeText={setEditedFirstName}
                    placeholder="First Name"
                    placeholderTextColor="#9ca3af"
                  />
                  <TextInput
                    style={styles.profileEditInput}
                    value={editedLastName}
                    onChangeText={setEditedLastName}
                    placeholder="Last Name"
                    placeholderTextColor="#9ca3af"
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity 
                      onPress={handleSaveProfile}
                      style={styles.profileSaveButton}
                      disabled={savingPreferences}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                        {savingPreferences ? 'Saving...' : '✓ Save'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      onPress={() => {
                        setEditingProfile(false);
                        setEditedUsername(user?.username || '');
                        setEditedFirstName(user?.first_name || '');
                        setEditedLastName(user?.last_name || '');
                      }}
                      style={styles.profileCancelButton}
                    >
                      <Text style={{ color: '#6b7280', fontSize: 13, fontWeight: '600' }}>✕ Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* Username Section */}
          <View style={{ borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12 }}>
            <Text style={[styles.profileLabel, { marginBottom: 8 }]}>Username (used for login)</Text>
            {!editingProfile ? (
              <Text style={styles.profileValue}>@{user?.username}</Text>
            ) : (
              <TextInput
                style={[styles.profileEditInput, { marginTop: 0 }]}
                value={editedUsername}
                onChangeText={setEditedUsername}
                placeholder="Username"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            )}
          </View>
        </View>
      </View>

      {/* AI Insights - What Clarity Thinks About You */}
      {aiSummary && (
        <View style={styles.profileSection}>
          <Text style={styles.profileSectionTitle}>✨ What Clarity Thinks About You</Text>
          <View style={[styles.profileCard, { backgroundColor: '#f0f9ff', borderLeftWidth: 4, borderLeftColor: '#6366f1' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#6366f1', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Your Daily Motivation
              </Text>
              <TouchableOpacity 
                onPress={refreshMotivation}
                disabled={refreshingMotivation}
                style={{ padding: 4, marginRight: -4 }}
              >
                <Text style={{ fontSize: 20, color: refreshingMotivation ? '#9ca3af' : '#6366f1' }}>
                  ⟳
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.profileValue, { fontSize: 16, lineHeight: 24, color: '#1e3a8a', fontWeight: '500' }]}>
              {aiSummary}
            </Text>
            <Text style={{ fontSize: 12, color: '#60a5fa', marginTop: 12, fontStyle: 'italic' }}>
              💡 Fresh motivation every time you log in
            </Text>
          </View>
        </View>
      )}

      {/* Show placeholder if no AI summary yet */}
      {!aiSummary && (
        <View style={styles.profileSection}>
          <Text style={styles.profileSectionTitle}>✨ What Clarity Thinks About You</Text>
          <View style={[styles.profileCard, { backgroundColor: '#f9fafb', borderLeftWidth: 4, borderLeftColor: '#9ca3af', paddingTop: 16, paddingBottom: 16 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text style={{ fontSize: 15, lineHeight: 22, color: '#6b7280', fontStyle: 'italic', flex: 1 }}>
                Complete a few tasks and I'll share some motivating thoughts with you! 🎯
              </Text>
              <TouchableOpacity 
                onPress={refreshMotivation}
                disabled={refreshingMotivation}
                style={{ padding: 4, marginLeft: 8 }}
              >
                <Text style={{ fontSize: 20, color: refreshingMotivation ? '#9ca3af' : '#6366f1' }}>
                  ⟳
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Work Preferences */}
      {Object.keys(preferences).length > 0 && (
        <View style={styles.profileSection}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={styles.profileSectionTitle}>⚙️ Your Preferences</Text>
            {!editingPreferences && (
              <TouchableOpacity onPress={() => setEditingPreferences(true)}>
                <Text style={{ color: '#6366f1', fontSize: 15, fontWeight: '600' }}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {!editingPreferences ? (
            <>
              <View style={styles.profileCard}>
                <Text style={styles.profileLabel}>⏰ Most Productive Time</Text>
                <Text style={styles.profileValue}>
                  {getPreferenceLabel('work_rhythm', preferences.work_rhythm || '')}
                </Text>
              </View>
              <View style={styles.profileCard}>
                <Text style={styles.profileLabel}>☕ Break Style</Text>
                <Text style={styles.profileValue}>
                  {getPreferenceLabel('break_preference', preferences.break_preference || '')}
                </Text>
              </View>
              <View style={styles.profileCard}>
                <Text style={styles.profileLabel}>⚡ Work Session Length</Text>
                <Text style={styles.profileValue}>
                  {getPreferenceLabel('work_style', preferences.work_style || '')}
                </Text>
              </View>
              <View style={styles.profileCard}>
                <Text style={styles.profileLabel}>📋 Planning Style</Text>
                <Text style={styles.profileValue}>
                  {getPreferenceLabel('planning_style', preferences.planning_style || '')}
                </Text>
              </View>
            </>
          ) : (
            <>
              {/* Work Rhythm */}
              <View style={styles.card}>
                <Text style={[styles.profileLabel, { marginBottom: 8 }]}>⏰ Most Productive Time</Text>
                {[
                  { value: 'early_bird', label: "Early Bird (5am-9am)" },
                  { value: 'morning_person', label: "Morning Person (9am-12pm)" },
                  { value: 'afternoon_warrior', label: "Afternoon Warrior (12pm-5pm)" },
                  { value: 'night_owl', label: "Night Owl (9pm-2am)" },
                ].map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.preferenceOption,
                      preferences.work_rhythm === option.value && styles.preferenceOptionSelected
                    ]}
                    onPress={() => setPreferences({ ...preferences, work_rhythm: option.value })}
                  >
                    <Text style={[
                      styles.preferenceOptionText,
                      preferences.work_rhythm === option.value && styles.preferenceOptionTextSelected
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Break Preference */}
              <View style={styles.card}>
                <Text style={[styles.profileLabel, { marginBottom: 8 }]}>☕ Break Style</Text>
                {[
                  { value: 'short_frequent', label: "Short & Sweet (5-10 min/hour)" },
                  { value: 'medium', label: "Balanced (15-20 min/2 hours)" },
                  { value: 'long_rare', label: "Long & Deep (30+ min)" },
                  { value: 'no_schedule', label: "Go with the flow" },
                ].map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.preferenceOption,
                      preferences.break_preference === option.value && styles.preferenceOptionSelected
                    ]}
                    onPress={() => setPreferences({ ...preferences, break_preference: option.value })}
                  >
                    <Text style={[
                      styles.preferenceOptionText,
                      preferences.break_preference === option.value && styles.preferenceOptionTextSelected
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Work Style */}
              <View style={styles.card}>
                <Text style={[styles.profileLabel, { marginBottom: 8 }]}>⚡ Work Session Length</Text>
                {[
                  { value: 'sprint', label: "Quick Sprints (20-30 min)" },
                  { value: 'standard', label: "Standard Blocks (45-60 min)" },
                  { value: 'deep_dive', label: "Deep Dive (90+ min)" },
                  { value: 'flexible', label: "Mix it up" },
                ].map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.preferenceOption,
                      preferences.work_style === option.value && styles.preferenceOptionSelected
                    ]}
                    onPress={() => setPreferences({ ...preferences, work_style: option.value })}
                  >
                    <Text style={[
                      styles.preferenceOptionText,
                      preferences.work_style === option.value && styles.preferenceOptionTextSelected
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Planning Style */}
              <View style={styles.card}>
                <Text style={[styles.profileLabel, { marginBottom: 8 }]}>📋 Planning Style</Text>
                {[
                  { value: 'detailed', label: "Every minute planned" },
                  { value: 'rough_outline', label: "Rough outline" },
                  { value: 'priorities', label: "Just priorities" },
                  { value: 'spontaneous', label: "Wing it" },
                ].map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.preferenceOption,
                      preferences.planning_style === option.value && styles.preferenceOptionSelected
                    ]}
                    onPress={() => setPreferences({ ...preferences, planning_style: option.value })}
                  >
                    <Text style={[
                      styles.preferenceOptionText,
                      preferences.planning_style === option.value && styles.preferenceOptionTextSelected
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Save/Cancel Buttons */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton, { flex: 1 }]}
                  onPress={handleSavePreferences}
                  disabled={savingPreferences}
                >
                  {savingPreferences ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { flex: 1, backgroundColor: '#6b7280' }]}
                  onPress={() => {
                    setEditingPreferences(false);
                    fetchProfile(); // Reload original preferences
                  }}
                  disabled={savingPreferences}
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* Google Calendar */}
      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>Integrations</Text>
        <View style={styles.profileCard}>
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
      tabBarShowLabel: true,
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '600',
        marginBottom: 4,
      },
      tabBarIconStyle: {
        marginTop: 4,
      },
    }}
  >
    <Tab.Screen
      name="Home"
      component={HomeScreen}
      options={{
        tabBarLabel: 'Home',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ fontSize: 24, color }}>🏠</Text>
        ),
      }}
    />
    <Tab.Screen
      name="Calendar"
      component={CalendarScreen}
      options={{
        tabBarLabel: 'Calendar',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ fontSize: 24, color }}>📅</Text>
        ),
      }}
    />
    <Tab.Screen
      name="Tasks"
      component={TasksScreen}
      options={{
        tabBarLabel: 'Tasks',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ fontSize: 24, color }}>✓</Text>
        ),
      }}
    />
    <Tab.Screen
      name="Chat"
      component={ChatScreen}
      options={{
        tabBarLabel: 'Chat',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ fontSize: 24, color }}>💬</Text>
        ),
      }}
    />
    <Tab.Screen
      name="Profile"
      component={ProfileScreen}
      options={{
        tabBarLabel: 'Profile',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ fontSize: 24, color }}>👤</Text>
        ),
      }}
    />
  </Tab.Navigator>
);

// ============================================================================
// MAIN APP
// ============================================================================

// ============================================================================
// ONBOARDING QUESTIONNAIRE COMPONENT
// ============================================================================

const OnboardingQuestionnaire: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const questions = [
    {
      id: 'work_rhythm',
      question: "When do you feel most productive? 🌅🌙",
      emoji: '⏰',
      options: [
        { value: 'early_bird', label: "Early Bird (5am-9am) - I'm up with the sun!" },
        { value: 'morning_person', label: "Morning Person (9am-12pm) - Fresh and ready!" },
        { value: 'afternoon_warrior', label: "Afternoon Warrior (12pm-5pm) - Post-lunch power!" },
        { value: 'night_owl', label: "Night Owl (9pm-2am) - The night is young!" },
      ]
    },
    {
      id: 'break_preference',
      question: "How do you like to take breaks? ☕",
      emoji: '🎯',
      options: [
        { value: 'short_frequent', label: "Short & Sweet (5-10 min every hour) - Quick recharge!" },
        { value: 'medium', label: "Balanced (15-20 min every 2 hours) - Classic approach" },
        { value: 'long_rare', label: "Long & Deep (30+ min, less often) - Real downtime" },
        { value: 'no_schedule', label: "Go with the flow - I break when I need to!" },
      ]
    },
    {
      id: 'work_style',
      question: "What's your ideal work session like? 💪",
      emoji: '⚡',
      options: [
        { value: 'sprint', label: "Quick Sprints (20-30 min bursts) - Fast & focused!" },
        { value: 'standard', label: "Standard Blocks (45-60 min) - The sweet spot" },
        { value: 'deep_dive', label: "Deep Dive (90+ min) - Flow state master!" },
        { value: 'flexible', label: "Mix it up - Depends on the task!" },
      ]
    },
    {
      id: 'planning_style',
      question: "How do you approach planning your day? 📅",
      emoji: '📋',
      options: [
        { value: 'detailed', label: "Every minute planned - I love structure!" },
        { value: 'rough_outline', label: "Rough outline - Know the big stuff" },
        { value: 'priorities', label: "Just priorities - Top 3 things today" },
        { value: 'spontaneous', label: "Wing it - I work better spontaneously!" },
      ]
    },
  ];

  const handleAnswer = (value: string) => {
    const newAnswers = { ...answers, [questions[currentQuestion].id]: value };
    setAnswers(newAnswers);

    if (currentQuestion < questions.length - 1) {
      setTimeout(() => setCurrentQuestion(currentQuestion + 1), 300);
    } else {
      // Save and complete
      saveOnboarding(newAnswers);
    }
  };

  const saveOnboarding = async (finalAnswers: any) => {
    setSaving(true);
    try {
      await api.post('/ai/onboarding/', { 
        responses: finalAnswers,
        onboarding_completed: true 
      });
      setTimeout(() => {
        onComplete();
      }, 500);
    } catch (error) {
      console.error('[ONBOARDING] Error saving:', error);
      Alert.alert('Error', 'Failed to save preferences. Please try again.');
      setSaving(false);
    }
  };

  const question = questions[currentQuestion];
  const progress = ((currentQuestion + 1) / questions.length) * 100;

  return (
    <Modal visible={true} animationType="fade" transparent={true}>
      <View style={styles.onboardingOverlay}>
        <View style={styles.onboardingContainer}>
          {/* Progress Bar */}
          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
          </View>

          {/* Question Number */}
          <Text style={styles.questionNumber}>
            Question {currentQuestion + 1} of {questions.length}
          </Text>

          {/* Emoji */}
          <Text style={styles.questionEmoji}>{question.emoji}</Text>

          {/* Question */}
          <Text style={styles.questionText}>{question.question}</Text>

          {/* Options */}
          <View style={styles.optionsContainer}>
            {question.options.map((option, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.optionButton,
                  answers[question.id] === option.value && styles.optionButtonSelected
                ]}
                onPress={() => handleAnswer(option.value)}
                disabled={saving}
              >
                <Text style={[
                  styles.optionText,
                  answers[question.id] === option.value && styles.optionTextSelected
                ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {saving && (
            <View style={{ marginTop: 20 }}>
              <ActivityIndicator size="large" color="#6366f1" />
              <Text style={{ textAlign: 'center', color: '#6b7280', marginTop: 8 }}>Saving your preferences...</Text>
            </View>
          )}

          {/* Navigation */}
          {currentQuestion > 0 && !saving && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setCurrentQuestion(currentQuestion - 1)}
            >
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ============================================================================
// MAIN APP WITH ONBOARDING
// ============================================================================

// Main content component that properly uses hooks
const MainContent: React.FC = () => {
  const { isAuthenticated, loading, user } = useContext(AuthContext);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);

  // Check onboarding status when authenticated
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (isAuthenticated && user) {
        try {
          const response = await api.get('/ai/memory/');
          const aiMemory = response.data;
          
          // Keep showing onboarding until completed
          if (!aiMemory.onboarding_completed) {
            setShowOnboarding(true);
          } else {
            setShowOnboarding(false);
          }
        } catch (error) {
          console.error('[APP] Error checking onboarding:', error);
          setShowOnboarding(false);
        }
      } else {
        setShowOnboarding(false);
      }
      setCheckingOnboarding(false);
    };

    if (isAuthenticated) {
      checkOnboardingStatus();
    } else {
      setCheckingOnboarding(false);
      setShowOnboarding(false);
    }
  }, [isAuthenticated, user]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  if (loading || (isAuthenticated && checkingOnboarding)) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={{ marginTop: 10 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <>
      {isAuthenticated ? (
        <MainTabs key="main-tabs" />
      ) : (
        <AuthStack key="auth-stack" />
      )}
      
      {isAuthenticated && showOnboarding && (
        <OnboardingQuestionnaire onComplete={handleOnboardingComplete} />
      )}
    </>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainContent />
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
  authScrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  authContentWrapper: {
    padding: 24,
    alignItems: 'center',
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
  checkboxButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  checkboxIcon: {
    fontSize: 24,
  },
  deleteButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: '#f3f4f6',
  },
  chatHeader: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#6366f1',
  },
  chatHeaderTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  chatHeaderSubtitle: {
    fontSize: 15,
    color: '#e0e7ff',
    opacity: 0.95,
  },
  tasksHeader: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#6366f1',
  },
  tasksHeaderTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  tasksHeaderSubtitle: {
    fontSize: 15,
    color: '#e0e7ff',
    opacity: 0.95,
  },
  referenceBar: {
    backgroundColor: '#eff6ff',
    borderTopWidth: 1,
    borderTopColor: '#bfdbfe',
    borderBottomWidth: 1,
    borderBottomColor: '#bfdbfe',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  referenceLabel: {
    fontSize: 11,
    color: '#6366f1',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  referenceTaskName: {
    fontSize: 15,
    color: '#1e3a8a',
    fontWeight: '600',
    marginTop: 2,
  },
  referenceCloseButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  referenceCloseText: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '600',
  },
  messagesList: {
    padding: 20,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 14,
    borderRadius: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#6366f1',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
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
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 5,
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
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
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
  onboardingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  onboardingContainer: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
  },
  // Home Page Styles
  homeSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 20,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  progressTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  progressLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 8,
  },
  progressCount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 16,
  },
  progressBarContainer: {
    height: 12,
    backgroundColor: '#e5e7eb',
    borderRadius: 6,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 6,
  },
  progressMessage: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e0e7ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statIcon: {
    fontSize: 20,
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  focusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  focusIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  focusTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  viewAllButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
  },
  emptyFocusCard: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyFocusText: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  focusCard: {
    backgroundColor: '#fafafa',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  focusCardContent: {
    flex: 1,
    marginRight: 12,
  },
  focusTaskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  focusTaskMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  focusTaskTime: {
    fontSize: 13,
    color: '#6b7280',
  },
  focusTaskDuration: {
    fontSize: 13,
    color: '#6b7280',
  },
  focusTaskLocation: {
    fontSize: 13,
    color: '#6b7280',
    flex: 1,
  },
  priorityBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  priorityBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
  helpSection: {
    backgroundColor: '#6366f1',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 100,
    padding: 24,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  helpTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  helpSubtitle: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
    marginBottom: 20,
    lineHeight: 20,
  },
  chatButton: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignSelf: 'flex-end',
  },
  chatButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6366f1',
  },
  welcomeHeader: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#6366f1',
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  welcomeSubtitle: {
    fontSize: 15,
    color: '#e0e7ff',
    opacity: 0.95,
  },
  profileHeader: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#6366f1',
  },
  profileHeaderTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  profileHeaderSubtitle: {
    fontSize: 15,
    color: '#e0e7ff',
    opacity: 0.95,
  },
  profileSection: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  profileSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  profileCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  logoutButton: {
    backgroundColor: '#ef4444',
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
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 3,
  },
  questionNumber: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  questionEmoji: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  questionText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 30,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    backgroundColor: '#f9fafb',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
  },
  optionButtonSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#6366f1',
  },
  optionText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
    textAlign: 'center',
  },
  optionTextSelected: {
    color: '#6366f1',
    fontWeight: '600',
  },
  backButton: {
    marginTop: 24,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backButtonText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '600',
  },
  preferenceOption: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  preferenceOptionSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#6366f1',
    borderWidth: 2,
  },
  preferenceOptionText: {
    fontSize: 14,
    color: '#374151',
  },
  preferenceOptionTextSelected: {
    color: '#6366f1',
    fontWeight: '600',
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
  profileImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e0e7ff',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  profileImagePlaceholder: {
    fontSize: 40,
  },
  profileImageBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileImageBadgeText: {
    fontSize: 12,
  },
  profileDisplayName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  profileDisplayEmail: {
    fontSize: 14,
    color: '#6b7280',
  },
  profileEditInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fff',
    marginTop: 8,
  },
  profileSaveButton: {
    flex: 1,
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  profileCancelButton: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  calendarHeader: {
    backgroundColor: '#6366f1',
    paddingTop: 60,
  },
  calendarHeaderTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  calendarHeaderSubtitle: {
    fontSize: 15,
    color: '#e0e7ff',
    opacity: 0.95,
  },
  viewSelector: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  viewButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
  },
  viewButtonActive: {
    backgroundColor: '#fff',
  },
  viewButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e0e7ff',
  },
  viewButtonTextActive: {
    color: '#6366f1',
  },
  // Monthly Calendar View Styles
  monthWeekdayHeader: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 8,
  },
  monthWeekdayCell: {
    flex: 1,
    alignItems: 'center',
  },
  monthWeekdayText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthDayCell: {
    width: '14.28%', // 100% / 7 days
    aspectRatio: 1,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: '#e5e7eb',
    padding: 4,
  },
  monthDayNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  monthDayNumberToday: {
    backgroundColor: '#6366f1',
  },
  monthDayText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  monthDayTextOther: {
    color: '#9ca3af',
  },
  monthDayTextToday: {
    color: '#fff',
    fontWeight: '700',
  },
  monthEventDots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 2,
    marginTop: 4,
  },
  monthEventDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  monthEventMore: {
    fontSize: 9,
    color: '#6b7280',
    fontWeight: '600',
  },
  // Timeline View Styles (Day/3-Day/Week)
  timeColumn: {
    width: 50,
    backgroundColor: '#f9fafb',
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
  },
  timeSlot: {
    height: 60,
    justifyContent: 'flex-start',
    paddingTop: 2,
    paddingRight: 4,
    alignItems: 'flex-end',
  },
  timeLabel: {
    fontSize: 9,
    color: '#6b7280',
    fontWeight: '500',
  },
  dayHeadersRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 2,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 8,
  },
  dayHeader: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dayHeaderWeekday: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  dayHeaderWeekdayToday: {
    color: '#6366f1',
  },
  dayHeaderNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  dayHeaderNumberToday: {
    backgroundColor: '#6366f1',
  },
  dayHeaderNumberText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  dayHeaderNumberTextToday: {
    color: '#fff',
  },
  dayColumn: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
    position: 'relative',
  },
  hourRow: {
    height: 60,
  },
  hourLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  eventsContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  timelineEvent: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: 4,
    padding: 4,
    overflow: 'hidden',
  },
  timelineEventTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  timelineEventTime: {
    fontSize: 9,
    color: '#e0e7ff',
    marginTop: 1,
  },
  timelineEventLocation: {
    fontSize: 9,
    color: '#e0e7ff',
    marginTop: 1,
  },
  dateNavigation: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  dateNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateNavButton: {
    padding: 10,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    minWidth: 44,
    alignItems: 'center',
  },
  dateNavArrow: {
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
  },
  dateNavCenter: {
    alignItems: 'center',
    flex: 1,
  },
  dateNavDate: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  dateNavDay: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  todayButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#6366f1',
    borderRadius: 8,
    alignSelf: 'center',
  },
  todayButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  taskTabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  taskTab: {
    flex: 1,
    paddingVertical: 14,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  taskTabActive: {
    borderBottomColor: '#6366f1',
  },
  taskTabText: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#9ca3af',
  },
  taskTabTextActive: {
    color: '#6366f1',
  },
  tabBar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    height: 85,
    paddingBottom: 20,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 10,
  },
});