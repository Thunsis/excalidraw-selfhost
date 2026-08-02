/**
 * 原生风格用户头像：圆形、品牌紫底、白色首字母
 * （对齐 Excalidraw+ 登录态头像样式）
 */
export const UserAvatar = ({
  username,
  size = 24,
}: {
  username: string;
  size?: number;
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      borderRadius: "50%",
      background: "#6965db",
      color: "#fff",
      fontSize: Math.max(size * 0.5, 10),
      fontWeight: 600,
      lineHeight: 1,
      userSelect: "none",
      flexShrink: 0,
    }}
    title={username}
  >
    {username.charAt(0).toUpperCase()}
  </span>
);
