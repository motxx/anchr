import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <View className="flex-1 bg-background items-center justify-center px-6">
          <View className="w-14 h-14 rounded-full bg-red-950 items-center justify-center mb-4">
            <Ionicons name="warning-outline" size={28} color="#ef4444" />
          </View>
          <Text className="text-base font-semibold text-foreground mb-1">
            Something went wrong
          </Text>
          <Text className="text-sm text-muted-foreground text-center mb-4">
            {this.state.error?.message ?? "An unexpected error occurred"}
          </Text>
          <Pressable
            onPress={this.handleRetry}
            className="bg-surface border border-border rounded-lg px-4 py-2"
          >
            <Text className="text-sm font-medium text-foreground">Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
