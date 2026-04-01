import { useAuthStore } from "../store/auth";

export function useNostrIdentity() {
  const { identity, publicKey, npub, secretKeyHex, loaded } = useAuthStore();
  return { identity, publicKey, npub, secretKeyHex, loaded, isLoggedIn: !!secretKeyHex };
}
