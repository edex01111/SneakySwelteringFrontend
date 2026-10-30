export const env = {
  port: Number(process.env.PORT || 5000),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramWebAppUrl: process.env.TELEGRAM_WEBAPP_URL || "",
  privyAppId: process.env.PRIVY_APP_ID || "",
  privyAppSecret: process.env.PRIVY_APP_SECRET || "",
  privyAuthorizationPrivateKey:
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || "",
  privyKeyQuorumId: process.env.PRIVY_KEY_QUORUM_ID || "",
  privyPolicyId: process.env.PRIVY_POLICY_ID || "",
  fomoApiKey: process.env.FOMO_API_KEY || "",
  zeroXApiKey: process.env.ZEROX_API_KEY || "",
  zeroXAllowedTargets: (process.env.ZEROX_ALLOWED_TARGETS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  baseRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  liveTradingEnabled: process.env.ENABLE_LIVE_TRADING === "true",
  maxEventAgeSeconds: Number(process.env.MAX_EVENT_AGE_SECONDS || 10),
};

export const isPrivyConfigured = Boolean(env.privyAppId && env.privyAppSecret);

export function liveReadiness(): { ready: boolean; missing: string[] } {
  const checks: Array<[string, boolean]> = [
    ["PRIVY_APP_ID", Boolean(env.privyAppId)],
    ["PRIVY_APP_SECRET", Boolean(env.privyAppSecret)],
    ["PRIVY_AUTHORIZATION_PRIVATE_KEY", Boolean(env.privyAuthorizationPrivateKey)],
    ["PRIVY_KEY_QUORUM_ID", Boolean(env.privyKeyQuorumId)],
    ["PRIVY_POLICY_ID", Boolean(env.privyPolicyId)],
    ["FOMO_API_KEY", Boolean(env.fomoApiKey)],
    ["ZEROX_API_KEY", Boolean(env.zeroXApiKey)],
    ["ZEROX_ALLOWED_TARGETS", env.zeroXAllowedTargets.length > 0],
    ["ENABLE_LIVE_TRADING", env.liveTradingEnabled],
  ];
  const missing = checks.filter(([, present]) => !present).map(([name]) => name);
  return { ready: missing.length === 0, missing };
}

