// Server component layout for dynamic [serial] route
// Required for Next.js static export with dynamic routes
// Returns empty array since device serials are dynamic and loaded client-side
export function generateStaticParams() {
    return [];
}

export default function SerialLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
