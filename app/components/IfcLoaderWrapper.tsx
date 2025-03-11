"use client";

import dynamic from "next/dynamic";

// Dynamically import the IfcLoader component with SSR disabled
const IfcLoader = dynamic(() => import("./IfcLoader"), {
  ssr: false,
  loading: () => <p>Loading IFC component...</p>,
});

export default function IfcLoaderWrapper() {
  return <IfcLoader />;
}
