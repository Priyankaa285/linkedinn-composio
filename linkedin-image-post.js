import "dotenv/config";
import { Composio, SessionPreset } from "@composio/core";

const USER_ID = process.env.COMPOSIO_USER_ID ?? "kishore";

const POST_TEXT = `🚀 Excited to share that I successfully completed the MCP Mega Workshop!

Through this project, I integrated Cursor IDE with Composio and LinkedIn to automate LinkedIn post creation. The workflow authenticates LinkedIn, generates content, and publishes posts automatically using AI-powered integrations.

Key Learnings:
✅ MCP (Model Context Protocol)
✅ Composio Toolkits
✅ LinkedIn Automation
✅ AI Agent Workflows
✅ Cursor IDE Integration`;

const IMAGE_URL =
  "https://media-content.ccbp.in/ccbp_prod/media/misc/mcp_megaworkshop.jpeg";

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
      "Unable to determine LinkedIn person URN"
    );
  }

  return personUrn;
}

async function uploadImageToLinkedIn(session, ownerUrn) {
  console.log(
    "Step 1: Registering image upload with LinkedIn..."
  );

  const registerResult = await session.execute(
    "LINKEDIN_REGISTER_IMAGE_UPLOAD",
    { owner_urn: ownerUrn }
  );

  if (registerResult.error) {
    throw new Error(registerResult.error);
  }

  const registerData = parseToolData(
    registerResult.data
  );

  const uploadUrl =
    registerData?.upload_url ??
    registerData?.uploadUrl ??
    registerData?.value?.uploadMechanism?.[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ]?.uploadUrl;

  const assetUrn =
    registerData?.asset_urn ??
    registerData?.assetUrn ??
    registerData?.value?.asset;

  if (!uploadUrl || !assetUrn) {
    throw new Error(
      `Unexpected register response: ${JSON.stringify(registerData)}`
    );
  }

  console.log("Step 2: Uploading image bytes to LinkedIn...");
  console.log("Asset URN:", assetUrn);

  const imageResponse = await fetch(IMAGE_URL);

  if (!imageResponse.ok) {
    throw new Error(
      `Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`
    );
  }

  const imageBytes = Buffer.from(
    await imageResponse.arrayBuffer()
  );

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/jpeg",
    },
    body: imageBytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `LinkedIn image upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
    );
  }

  console.log("Image uploaded to LinkedIn successfully.");

  return assetUrn;
}

async function createLinkedInImagePost(
  session,
  { author, commentary, assetUrn }
) {
  console.log(
    "Step 3: Creating and publishing public LinkedIn post..."
  );

  const stagedImage = await composio.files.upload({
    file: IMAGE_URL,
    toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
    toolkitSlug: "linkedin",
  });

  const result = await session.execute(
    "LINKEDIN_CREATE_LINKED_IN_POST",
    {
      author,
      commentary,
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      images: [stagedImage],
    }
  );

  if (result.error) {
    throw new Error(result.error);
  }

  return { result, assetUrn };
}

async function main() {
  if (!process.env.COMPOSIO_API_KEY) {
    throw new Error(
      "COMPOSIO_API_KEY missing in .env"
    );
  }

  console.log(
    "\nCreating LinkedIn image post via Composio...\n"
  );

  const session = await composio.create(USER_ID, {
    sessionPreset: SessionPreset.DIRECT_TOOLS,
    toolkits: {
      enable: ["linkedin"],
    },
    manageConnections: {
      waitForConnections: false,
    },
  });

  await ensureLinkedInConnection(session);

  const author =
    await getAuthenticatedPersonUrn(session);

  console.log(`Posting as ${author}\n`);

  const assetUrn = await uploadImageToLinkedIn(
    session,
    author
  );

  const { result } = await createLinkedInImagePost(
    session,
    {
      author,
      commentary: POST_TEXT,
      assetUrn,
    }
  );

  const postUrn = extractPostUrn(result);
  const postUrl = toLinkedInPostUrl(postUrn);

  console.log(
    "\nLinkedIn image post published successfully.\n"
  );
  console.log("Image Asset URN:", assetUrn);

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
  process.exit(1);
});
