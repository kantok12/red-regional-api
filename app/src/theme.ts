import { Appearance } from "react-native";

const light = {
  bg: "#f4f5f7",
  surface: "#ffffff",
  text: "#14171a",
  muted: "#5f6b76",
  border: "#dde1e6",
  accent: "#0b6bcb",
  danger: "#c62828",
};

const dark: typeof light = {
  bg: "#0f1214",
  surface: "#1a1f23",
  text: "#eef1f4",
  muted: "#9aa6b1",
  border: "#2c343a",
  accent: "#5aa9ff",
  danger: "#ff6b6b",
};

export const colors = Appearance.getColorScheme() === "dark" ? dark : light;
