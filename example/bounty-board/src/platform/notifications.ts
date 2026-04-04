import { Platform } from "react-native";

export interface NotificationContent {
  title: string;
  subtitle?: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationProvider {
  requestPermission(): Promise<boolean>;
  configureForegroundHandler(): void;
  scheduleImmediate(content: NotificationContent): Promise<void>;
}

function createNativeProvider(): NotificationProvider {
  return {
    async requestPermission() {
      const Notifications = await import("expo-notifications");
      const { status: existing } = await Notifications.getPermissionsAsync();
      if (existing === "granted") return true;
      const { status } = await Notifications.requestPermissionsAsync();
      return status === "granted";
    },
    configureForegroundHandler() {
      import("expo-notifications").then((Notifications) => {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });
      });
    },
    async scheduleImmediate(content) {
      const Notifications = await import("expo-notifications");
      await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title,
          subtitle: content.subtitle,
          body: content.body,
          data: content.data,
        },
        trigger: null,
      });
    },
  };
}

function createWebProvider(): NotificationProvider {
  return {
    async requestPermission() {
      if (typeof Notification === "undefined") return false;
      if (Notification.permission === "granted") return true;
      const result = await Notification.requestPermission();
      return result === "granted";
    },
    configureForegroundHandler() {},
    async scheduleImmediate(content) {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      new Notification(content.title, {
        body: content.body,
        tag: content.data?.queryId as string | undefined,
      });
    },
  };
}

export function createNotificationProvider(): NotificationProvider {
  return Platform.OS === "web" ? createWebProvider() : createNativeProvider();
}

export const notificationProvider = createNotificationProvider();
