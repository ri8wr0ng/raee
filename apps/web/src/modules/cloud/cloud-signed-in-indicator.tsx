import { useCloudAuth } from "./cloud-auth";

// Loaded only when cloud is configured, so a cloud session is always mounted above it.
export default function CloudSignedInIndicator() {
  const { user, isLoading } = useCloudAuth();
  if (isLoading || !user) return null;
  return (
    <>
      <span aria-hidden="true" className="ml-1.5 size-1.5 rounded-full bg-primary" />
      <span className="sr-only">(signed in as {user.email})</span>
    </>
  );
}
