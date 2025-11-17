import { Stack } from 'expo-router';

// Use expo-router's Stack here as the root navigator. This provides the single
// NavigationContainer for the app. Individual route files (in `app/`) will be
// rendered as screens inside this stack.
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
