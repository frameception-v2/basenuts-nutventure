"use client";

import { useEffect, useCallback, useState } from "react";
import Image from 'next/image';
import sdk, {
  AddFrame,
  SignIn as SignInCore,
  type Context,
} from "@farcaster/frame-sdk";
import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";
import { NEYNAR_API_KEY, DAILY_ALLOWANCE } from "~/lib/constants";
import { PurpleButton } from "~/components/ui/PurpleButton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "~/components/ui/card";

import { config } from "~/components/providers/WagmiProvider";
import { truncateAddress } from "~/lib/truncateAddress";
import { base, optimism } from "wagmi/chains";
import { useSession } from "next-auth/react";
import { createStore } from "mipd";
import { Label } from "~/components/ui/label";
import { PROJECT_TITLE } from "~/lib/constants";

interface NutData {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  sentNuts: number;
  receivedNuts: number;
  failedAttempts: number;
  lastUpdated: Date;
}

interface NutStats {
  totalReceived: number;
  totalSent: number;
  dailyUsed: number;
  failedAttempts: number;
}

const getDailyResetTime = () => {
  const now = new Date();
  const reset = new Date(now);
  reset.setUTCHours(11, 0, 0, 0);
  if (now > reset) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
};

async function fetchUserNuts(fid: number): Promise<NutStats> {
  const config = new Configuration({ apiKey: NEYNAR_API_KEY });
  const client = new NeynarAPIClient(config);
  
  // Get user details
  const { users } = await client.fetchBulkUsers({ fids: [fid] });
  const user = users[0];
  
  // Fetch all casts since Feb 1 2025 with 🥜 emoji
  const startDate = new Date('2025-02-01T00:00:00Z');
  const casts = await client.fetchAllCastsCreatedByUser(fid, {
    startTimestamp: startDate.toISOString(),
    limit: 1000
  });

  let receivedNuts = 0;
  let sentNuts = 0;
  
  // Analyze casts and replies
  for (const cast of casts) {
    // Count nuts in user's casts
    sentNuts += (cast.text.match(/🥜/g) || []).length;
    
    // Count nuts in replies to user's casts
    if (cast.replies?.casts) {
      for (const reply of cast.replies.casts) {
        receivedNuts += (reply.text.match(/🥜/g) || []).length;
      }
    }
  }

  // Calculate daily allowance usage
  const now = new Date();
  const dailyReset = getDailyResetTime();
  const timeSinceReset = now.getTime() - dailyReset.getTime();
  const dailyUsed = Math.min(DAILY_ALLOWANCE, Math.floor(timeSinceReset / (1000 * 60 * 60 * 24)) * DAILY_ALLOWANCE);

  return {
    totalReceived: receivedNuts,
    totalSent: sentNuts,
    dailyUsed,
    failedAttempts: Math.max(0, sentNuts - dailyUsed)
  };
}

function NutCounter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center p-2 bg-gray-100 dark:bg-gray-800 rounded-lg m-1">
      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</span>
      <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{value}</span>
    </div>
  );
}

function NutUserCard({ userData, nutStats }: { userData: Context.FrameContext['user']; nutStats: NutStats }) {
  const remainingDaily = DAILY_ALLOWANCE - nutStats.dailyUsed;
  const resetTime = getDailyResetTime();

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-400/20 to-amber-600/10" />
      <CardHeader>
        <div className="flex items-center gap-4">
          <Image 
            src={userData.pfpUrl}
            alt="Profile picture"
            width={48}
            height={48}
            className="rounded-full border-2 border-amber-500"
          />
          <div>
            <CardTitle className="text-amber-700 dark:text-amber-300">
              {userData.displayName}
            </CardTitle>
            <CardDescription>@{userData.username} · FID: {userData.fid}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <NutCounter label="Sent 🥜" value={nutStats.totalSent} />
          <NutCounter label="Received 🥜" value={nutStats.totalReceived} />
          <NutCounter label="Daily Left" value={remainingDaily} />
          <NutCounter label="Failed Attempts" value={nutStats.failedAttempts} />
        </div>
        
        <div className="text-center text-sm text-amber-600 dark:text-amber-400">
          Daily allowance resets in {Math.ceil((resetTime.getTime() - Date.now()) / 3600000)} hours
        </div>
      </CardContent>
    </Card>
  );
}

export default function Frame() {
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [context, setContext] = useState<Context.FrameContext>();
  const [nutStats, setNutStats] = useState<NutStats>({
    totalReceived: 0,
    totalSent: 0,
    dailyUsed: 0,
    failedAttempts: 0
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [added, setAdded] = useState(false);

  const [addFrameResult, setAddFrameResult] = useState("");

  const addFrame = useCallback(async () => {
    try {
      await sdk.actions.addFrame();
    } catch (error) {
      if (error instanceof AddFrame.RejectedByUser) {
        setAddFrameResult(`Not added: ${error.message}`);
      }

      if (error instanceof AddFrame.InvalidDomainManifest) {
        setAddFrameResult(`Not added: ${error.message}`);
      }

      setAddFrameResult(`Error: ${error}`);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      const context = await sdk.context;
      if (!context) {
        return;
      }

      setContext(context);
      setAdded(context.client.added);

      // If frame isn't already added, prompt user to add it
      if (!context.client.added) {
        addFrame();
      }

      sdk.on("frameAdded", ({ notificationDetails }) => {
        setAdded(true);
      });

      sdk.on("frameAddRejected", ({ reason }) => {
        console.log("frameAddRejected", reason);
      });

      sdk.on("frameRemoved", () => {
        console.log("frameRemoved");
        setAdded(false);
      });

      sdk.on("notificationsEnabled", ({ notificationDetails }) => {
        console.log("notificationsEnabled", notificationDetails);
      });
      sdk.on("notificationsDisabled", () => {
        console.log("notificationsDisabled");
      });

      sdk.on("primaryButtonClicked", () => {
        console.log("primaryButtonClicked");
      });

      console.log("Calling ready");
      sdk.actions.ready({});
      
      // Initial stats load
      if (context?.user?.fid) {
        fetchUserNuts(context.user.fid)
          .then(setNutStats)
          .catch((err) => setError(err.message));
      }

      // Set up real-time updates
      const interval = setInterval(async () => {
        if (context?.user?.fid) {
          try {
            const stats = await fetchUserNuts(context.user.fid);
            setNutStats(stats);
          } catch (error) {
            console.error("Real-time update failed:", error);
          }
        }
      }, 1000);

      return () => clearInterval(interval);

      // Set up a MIPD Store, and request Providers.
      const store = createStore();

      // Subscribe to the MIPD Store.
      store.subscribe((providerDetails) => {
        console.log("PROVIDER DETAILS", providerDetails);
        // => [EIP6963ProviderDetail, EIP6963ProviderDetail, ...]
      });
    };
    if (sdk && !isSDKLoaded) {
      console.log("Calling load");
      setIsSDKLoaded(true);
      load();
      return () => {
        sdk.removeAllListeners();
      };
    }
  }, [isSDKLoaded, addFrame]);

  if (!isSDKLoaded) {
    return <div>Loading...</div>;
  }

  return (
    <div
      style={{
        paddingTop: context?.client.safeAreaInsets?.top ?? 0,
        paddingBottom: context?.client.safeAreaInsets?.bottom ?? 0,
        paddingLeft: context?.client.safeAreaInsets?.left ?? 0,
        paddingRight: context?.client.safeAreaInsets?.right ?? 0,
      }}
    >
      <div className="w-[320px] mx-auto py-2 px-2">
        <div className="flex items-center justify-center gap-2 mb-4">
          <h1 className="text-3xl font-bold text-center text-amber-700 dark:text-amber-300 animate-bounce">
            {PROJECT_TITLE}
          </h1>
          <span className="text-3xl">🥜</span>
        </div>

        {context?.user ? (
          <NutUserCard 
            userData={context.user}
            nutStats={nutStats}
          />
        ) : (
          <Card className="p-4 text-center">
            <span className="text-lg">Connect to view your 🥜 stats!</span>
          </Card>
        )}

        <div className="flex gap-2 mt-4">
          <PurpleButton
            onClick={async () => {
              try {
                setLoading(true);
                const stats = await fetchUserNuts(context!.user.fid);
                setNutStats(stats);
              } catch (error) {
                console.error("Failed to refresh nuts:", error);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            {loading ? "Updating..." : "Nuts State"}
          </PurpleButton>
          
          <PurpleButton
            onClick={() => sdk.actions.shareFrame()}
          >
            Share It
          </PurpleButton>
        </div>
      </div>
    </div>
  );
}
