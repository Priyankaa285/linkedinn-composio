import "dotenv/config";
import { Composio, SessionPreset } from "@composio/core";

const USER_ID = process.env.COMPOSIO_USER_ID ?? "kishore";

const POST_TEXT =
  process.env.LINKEDIN_POST_TEXT ??
  "We've made it easy for you to post on LinkedIn! Choose from a set of ready-made post templates to showcase your work - just pick one that fits your style and share it with the world.";

const POST_VISIBILITY =
  process.env.LINKEDIN_POST_VISIBILITY ?? "PUBLIC";

const LIFECYCLE_STATE =
  process.env.LINKEDIN_LIFECYCLE_STATE ?? "PUBLISHED";

console.log(
  "Key length:",
  process.env.COMPOSIO_API_KEY?.length ?? 0
);

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  toolkitVersions: {
    linkedin: "20260424_00",
  },
});

function parseToolData(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

function getPersonUrn(profile) {
  if (typeof profile === "string") {
    return profile.startsWith("urn:li:person:")
      ? profile
      : null;
  }

  const directUrn =
    profile?.personUrn ??
    profile?.urn ??
    profile?.author ??
    profile?.["@id"];

  if (
    typeof directUrn === "string" &&
    directUrn.startsWith("urn:li:person:")
  ) {
    return directUrn;
  }

  const id =
    profile?.id ??
    profile?.sub ??
    profile?.personId;

  return id ? `urn:li:person:${id}` : null;
}

function extractPostUrn(result) {
  const parsed = parseToolData(result.data);

  const candidates = [
    parsed?.post_urn,
    parsed?.postUrn,
    parsed?.id,
    parsed?.urn,
    parsed?.["x-restli-id"],
    parsed?.x_restli_id,
    parsed?.share_id,
    parsed?.shareId,
    typeof parsed === "string" ? parsed : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const value = String(candidate);

    if (value.startsWith("urn:li:")) {
      return value;
    }

    if (/^\d+$/.test(value)) {
      return `urn:li:share:${value}`;
    }
  }

  return null;
}

function toLinkedInPostUrl(postUrn) {
  if (!postUrn) return null;

  return `https://www.linkedin.com/feed/update/${encodeURIComponent(
    postUrn
  )}`;
}

async function ensureLinkedInConnection(session) {
  const { items } = await session.toolkits({
    toolkits: ["linkedin"],
  });

  const linkedin = items.find(
    (toolkit) => toolkit.slug === "linkedin"
  );

  if (linkedin?.connection?.isActive) {
    console.log("LinkedIn connection is active.");
    return;
  }

  const connectionRequest =
    await session.authorize("linkedin");

  if (connectionRequest.redirectUrl) {
    console.log(
      "\nOpen the following URL and connect LinkedIn:\n"
    );
    console.log(connectionRequest.redirectUrl);
  }

  await connectionRequest.waitForConnection(
    120000
  );

  console.log("LinkedIn connected successfully.");
}

async function getAuthenticatedPersonUrn(session) {
  const result = await session.execute(
    "LINKEDIN_GET_MY_INFO"
  );

  if (result.error) {
    throw new Error(result.error);
  }

  const profile = parseToolData(result.data);

  const personUrn = getPersonUrn(profile);

  if (!personUrn) {
    throw new Error(
      `Unable to determine LinkedIn person URN`
    );
  }

  return personUrn;
}

async function createLinkedInTextPost(
  session,
  {
    author,
    commentary,
    visibility,
    lifecycleState,
  }
) {
  const result = await session.execute(
    "LINKEDIN_CREATE_LINKED_IN_POST",
    {
      author,
      commentary,
      visibility,
      lifecycleState,
    }
  );

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

async function main() {
  if (!process.env.COMPOSIO_API_KEY) {
    throw new Error(
      "COMPOSIO_API_KEY missing in .env"
    );
  }

  console.log(
    "\nCreating LinkedIn text post via Composio...\n"
  );

  const session = await composio.create(
    USER_ID,
    {
      sessionPreset:
        SessionPreset.DIRECT_TOOLS,
      toolkits: {
        enable: ["linkedin"],
      },
      manageConnections: {
        waitForConnections: false,
      },
    }
  );

  await ensureLinkedInConnection(session);

  const author =
    await getAuthenticatedPersonUrn(
      session
    );

  console.log(`Posting as ${author}\n`);

  const result =
    await createLinkedInTextPost(
      session,
      {
        author,
        commentary: POST_TEXT,
        visibility: POST_VISIBILITY,
        lifecycleState: LIFECYCLE_STATE,
      }
    );

  const postUrn =
    extractPostUrn(result);

  const postUrl =
    toLinkedInPostUrl(postUrn);

  console.log(
    "\nLinkedIn post published successfully.\n"
  );

  if (postUrn) {
    console.log("Post URN:", postUrn);
  }

  if (postUrl) {
    console.log("Post URL:", postUrl);
  }

  console.log(
    "\nResponse:\n",
    JSON.stringify(result, null, 2)
  );
}

main().catch((err) => {
  console.error(
    "\nError:",
    err.message || err
  );
});