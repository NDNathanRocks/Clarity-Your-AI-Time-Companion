import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Get API URLs from environment variables
const API_URL_WEB = process.env.EXPO_PUBLIC_API_URL_WEB || 'http://localhost:8000/api';
const API_URL_MOBILE = process.env.EXPO_PUBLIC_API_URL_MOBILE || 'http://172.16.137.78:8000/api';

/**
 * Get the appropriate API base URL based on the platform
 * - Web: Uses localhost
 * - iOS: Uses the mobile IP (your laptop's IP address)
 * - Android: Uses the mobile IP (your laptop's IP address)
 */
export const getApiBaseUrl = (): string => {
  if (Platform.OS === 'web') {
    return API_URL_WEB;
  }
  
  // For iOS and Android (Expo Go or physical devices)
  return API_URL_MOBILE;
};

// Export the API base URL as a constant for convenience
export const API_BASE_URL = getApiBaseUrl();

// For debugging - log the current API URL
console.log(`[CONFIG] API Base URL: ${API_BASE_URL}`);
console.log(`[CONFIG] Platform: ${Platform.OS}`);
