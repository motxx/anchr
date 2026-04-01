import { Redirect } from "expo-router";
import { useAuthStore } from "../src/store/auth";

export default function Index() {
  const secretKeyHex = useAuthStore((s) => s.secretKeyHex);

  if (!secretKeyHex) {
    return <Redirect href="/(auth)/welcome" />;
  }

  return <Redirect href="/(tabs)" />;
}
