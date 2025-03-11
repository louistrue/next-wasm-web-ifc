"use client";

import React, { useState } from "react";
import Script from "next/script";

// Define types for WebIFC API
interface WebIFCApi {
  IfcAPI: new () => IfcAPI;
}

// Define property interface with proper indexing
interface IfcProperty {
  value?: string | number;
  [key: string]: unknown;
}

// Define IFC element interface with flexible typing
interface IfcElement {
  type: string | number;
  Name?: IfcProperty;
  GlobalId?: IfcProperty;
  [key: string]: unknown;
}

// Define the API interface with the additional methods from web-ifc-api.d.ts
interface IfcAPI {
  SetWasmPath(path: string, absolute?: boolean): void;
  Init(): Promise<void>;
  OpenModel(data: Uint8Array): number;
  GetAllLines(modelID: number): { size(): number; get(index: number): number };
  CloseModel(modelID: number): void;
  GetLine(modelID: number, expressID: number, flatten?: boolean): IfcElement;
  GetNameFromTypeCode(type: number): string;
  IsIfcElement(type: number): boolean;
  properties: {
    getPropertySets(
      modelID: number,
      elementID: number,
      recursive?: boolean
    ): Promise<IfcElement[]>;
    getSpatialStructure(
      modelID: number,
      includeProperties?: boolean
    ): Promise<SpatialNode>;
  };
}

// Interface for property value
interface PropertyValue {
  name: string;
  value: string | number | boolean | null;
  type: string;
}

// Interface for property set
interface PropertySet {
  name: string;
  properties: PropertyValue[];
}

// Interface for physical element with properties
interface IfcModelElement {
  id: number;
  type: string;
  typeName: string;
  name: string;
  globalId?: string;
  propertySets: PropertySet[];
  rawElement?: Record<string, unknown>;
}

// Interface for spatial structure node
interface SpatialNode {
  expressID: number;
  type: string | number;
  children: SpatialNode[];
}

// Physical element types we're interested in
const PHYSICAL_ELEMENT_TYPES = [
  "IFCWALL",
  "IFCSLAB",
  "IFCDOOR",
  "IFCWINDOW",
  "IFCCOLUMN",
  "IFCBEAM",
  "IFCROOF",
  "IFCSTAIR",
  "IFCRAILING",
  "IFCFURNISHINGELEMENT",
  "IFCCURTAINWALL",
  "IFCMEMBER",
  "IFCPLATE",
  // Add more element types as needed or set to empty array to show all
];

export default function IfcBuiltElementsLoader() {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elements, setElements] = useState<IfcModelElement[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [elementsByType, setElementsByType] = useState<
    Record<string, IfcModelElement[]>
  >({});
  const [ifcApi, setIfcApi] = useState<IfcAPI | null>(null);
  const [modelID, setModelID] = useState<number | null>(null);
  const [showAllElements, setShowAllElements] = useState(false);
  const [showRawData, setShowRawData] = useState(false);

  // Function to add logs
  const addLog = (message: string) => {
    setLogs((prevLogs) => [
      ...prevLogs,
      `[${new Date().toISOString()}] ${message}`,
    ]);
  };

  // Helper function to check if a type name matches our physical elements
  const isPhysicalElementByName = (typeName: string): boolean => {
    // If we want to show all elements, return true
    if (PHYSICAL_ELEMENT_TYPES.length === 0) return true;

    const upperCaseType = typeName.toUpperCase();
    return PHYSICAL_ELEMENT_TYPES.some((type) => upperCaseType.includes(type));
  };

  // Extract property value from IFC property with improved naming
  const extractPropertyValue = (
    prop: unknown,
    propName: string
  ): PropertyValue | null => {
    let value: string | number | boolean | null = null;
    let type = "Unknown";
    let name = propName;

    // Skip OwnerHistory properties
    if (propName.includes("OwnerHistory")) {
      return null;
    }

    // Try to extract the value
    if (prop === null || prop === undefined) {
      return null;
    } else if (typeof prop === "object" && prop !== null && "value" in prop) {
      value = (prop as { value?: string | number | boolean }).value ?? null;
      type = typeof value;
    } else if (typeof prop !== "object") {
      value = prop as string | number | boolean;
      type = typeof value;
    } else {
      return null;
    }

    // Improve property naming for better readability
    if (propName.includes("Quantities[") && propName.includes("VolumeValue")) {
      name = "Volume";
    } else if (
      propName.includes("Quantities[") &&
      propName.includes("AreaValue")
    ) {
      name = "Area";
    } else if (
      propName.includes("Quantities[") &&
      propName.includes("LengthValue")
    ) {
      name = "Length";
    } else if (propName.includes("HasProperties[0].NominalValue")) {
      name = "IsExternal";
    } else if (propName.includes("HasProperties[1].NominalValue")) {
      name = "LoadBearing";
    } else if (
      propName.includes("HasProperties[") &&
      propName.includes("NominalValue")
    ) {
      // Extract property name from pattern if possible
      const match = /HasProperties\[\d+\]\.Name\.value\s*=\s*['"]([^'"]+)['"]/;
      if (match && match[1]) {
        name = match[1];
      } else {
        name = propName.replace(
          /HasProperties\[\d+\]\.NominalValue/,
          "Property"
        );
      }
    }

    return {
      name,
      value,
      type,
    };
  };

  // Extract all properties from a property set with filtering
  const extractPropertySet = (propSet: IfcElement): PropertySet => {
    const properties: PropertyValue[] = [];
    const setName =
      propSet.Name?.value !== undefined
        ? String(propSet.Name.value)
        : "Unnamed Set";

    // Extract relevant property names first if available
    const propertyNames: Record<string, string> = {};
    if (propSet.HasProperties && Array.isArray(propSet.HasProperties)) {
      for (let i = 0; i < propSet.HasProperties.length; i++) {
        const prop = propSet.HasProperties[i];
        if (prop.Name && prop.Name.value !== undefined) {
          propertyNames[`HasProperties[${i}]`] = String(prop.Name.value);
        }
      }
    }

    // Extract all properties from the property set
    for (const [key, value] of Object.entries(propSet)) {
      // Skip certain keys that are not actual properties
      if (
        ["type", "Name", "GlobalId", "expressID", "OwnerHistory"].includes(key)
      ) {
        continue;
      }

      if (Array.isArray(value)) {
        // Handle array properties
        for (let i = 0; i < value.length; i++) {
          const item = value[i];

          // Check if this is a quantity property with a value we're interested in
          if (key === "Quantities") {
            // Extract volume, area, or length values directly
            if (item.VolumeValue && item.VolumeValue.value !== undefined) {
              const propValue = {
                name: item.Name?.value ? String(item.Name.value) : "Volume",
                value: Number(item.VolumeValue.value),
                type: "number",
              };
              properties.push(propValue);
            } else if (item.AreaValue && item.AreaValue.value !== undefined) {
              const propValue = {
                name: item.Name?.value ? String(item.Name.value) : "Area",
                value: Number(item.AreaValue.value),
                type: "number",
              };
              properties.push(propValue);
            } else if (
              item.LengthValue &&
              item.LengthValue.value !== undefined
            ) {
              const propValue = {
                name: item.Name?.value ? String(item.Name.value) : "Length",
                value: Number(item.LengthValue.value),
                type: "number",
              };
              properties.push(propValue);
            }
          } else if (key === "HasProperties") {
            // For properties with nominal values
            if (item.NominalValue && item.NominalValue.value !== undefined) {
              let propName = `Property ${i + 1}`;

              // Try to get the property name
              if (item.Name && item.Name.value !== undefined) {
                propName = String(item.Name.value);
              } else if (propertyNames[`HasProperties[${i}]`]) {
                propName = propertyNames[`HasProperties[${i}]`];
              } else if (i === 0) {
                propName = "IsExternal";
              } else if (i === 1) {
                propName = "LoadBearing";
              }

              const propValue = {
                name: propName,
                value: item.NominalValue.value,
                type: typeof item.NominalValue.value,
              };
              properties.push(propValue);
            }
          }
        }
      } else if (
        typeof value === "object" &&
        value !== null &&
        !key.includes("OwnerHistory")
      ) {
        // Handle object properties that aren't OwnerHistory
        if ("value" in value && value.value !== undefined) {
          // Direct property with value
          const propValue = extractPropertyValue(value, key);
          if (propValue && propValue.value !== null) {
            properties.push(propValue);
          }
        }
      }
    }

    return {
      name: setName,
      properties,
    };
  };

  // Extract all properties from all property sets
  const extractAllProperties = async (
    api: IfcAPI,
    modelId: number,
    elementId: number
  ): Promise<PropertySet[]> => {
    try {
      // Get property sets for the element
      const propertySets = await api.properties.getPropertySets(
        modelId,
        elementId,
        true
      );
      const result: PropertySet[] = [];

      // Extract properties from each property set
      for (const set of propertySets) {
        const propertySet = extractPropertySet(set);
        if (propertySet.properties.length > 0) {
          result.push(propertySet);
        }
      }

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      addLog(`Error getting properties for element ${elementId}: ${errMsg}`);
      return [];
    }
  };

  // Process a node from the spatial structure and extract element data with properties
  const processModelElement = async (
    node: SpatialNode,
    api: IfcAPI,
    modelId: number,
    includeAll: boolean = false
  ): Promise<IfcModelElement | null> => {
    try {
      // Get the full element data
      const element = api.GetLine(modelId, node.expressID, true);

      // Determine if this is a physical element
      let typeName: string;
      let isPhysical = false;

      if (typeof node.type === "string") {
        typeName = node.type;
        isPhysical = isPhysicalElementByName(node.type);
      } else if (typeof node.type === "number") {
        typeName = api.GetNameFromTypeCode(node.type);
        isPhysical = isPhysicalElementByName(typeName);
      } else {
        return null; // Skip elements with unknown type
      }

      // If not a physical element and we're not including all elements, skip
      if (!isPhysical && !includeAll) {
        return null;
      }

      // Extract name
      let name = "Unnamed";
      if (element.Name && element.Name.value !== undefined) {
        name = String(element.Name.value);
      } else if (element.GlobalId && element.GlobalId.value !== undefined) {
        name = `[${String(element.GlobalId.value)}]`;
      } else {
        name = `Element #${node.expressID}`;
      }

      // Extract GlobalId if available
      let globalId: string | undefined;
      if (element.GlobalId && element.GlobalId.value !== undefined) {
        globalId = String(element.GlobalId.value);
      }

      // Get all properties for this element
      const propertySets = await extractAllProperties(
        api,
        modelId,
        node.expressID
      );

      // Create element object
      const modelElement: IfcModelElement = {
        id: node.expressID,
        type: typeName,
        typeName: typeName.replace("Ifc", ""), // Remove 'Ifc' prefix for cleaner display
        name,
        globalId,
        propertySets,
        rawElement: showRawData
          ? (element as unknown as Record<string, unknown>)
          : undefined,
      };

      addLog(
        `Found element: ${typeName} - ${name} (ID: ${node.expressID}) with ${propertySets.length} property sets`
      );

      return modelElement;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      addLog(`Error processing element ${node.expressID}: ${errMsg}`);
      return null;
    }
  };

  // Recursively process spatial structure to extract all elements
  const extractModelElements = async (
    node: SpatialNode,
    api: IfcAPI,
    modelId: number,
    includeAll: boolean = false
  ): Promise<IfcModelElement[]> => {
    const results: IfcModelElement[] = [];

    // Process the current node
    const element = await processModelElement(node, api, modelId, includeAll);
    if (element) {
      results.push(element);
    }

    // Process all children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childElements = await extractModelElements(
          child,
          api,
          modelId,
          includeAll
        );
        results.push(...childElements);
      }
    }

    return results;
  };

  // Process IFC file
  async function processFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;

    setLoading(true);
    setResult(null);
    setError(null);
    setElements([]);
    setLogs([]);
    setElementsByType({});
    setModelID(null);

    const file = event.target.files[0];
    addLog(`Processing file: ${file.name}`);

    try {
      // Check if WebIFC is available
      if (
        typeof window === "undefined" ||
        !(window as unknown as { WebIFC?: WebIFCApi }).WebIFC
      ) {
        throw new Error("WebIFC not loaded yet");
      }

      // Create API instance
      const WebIFC = (window as unknown as { WebIFC: WebIFCApi }).WebIFC;
      const api = new WebIFC.IfcAPI();
      setIfcApi(api);

      // Set WASM path (absolute)
      api.SetWasmPath("/wasm/web-ifc/", true);
      addLog("Using WASM path (absolute): /wasm/web-ifc/");

      // Initialize the API
      await api.Init();
      addLog("IFC API initialized successfully");

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      addLog(`File read successfully, size: ${arrayBuffer.byteLength} bytes`);

      // Open the model
      const modelID = api.OpenModel(new Uint8Array(arrayBuffer));
      setModelID(modelID);
      addLog(`Model opened with ID: ${modelID}`);

      // Get total entities count
      const allItems = api.GetAllLines(modelID);
      addLog(`Total entities found: ${allItems.size()}`);

      // Get spatial structure
      try {
        const spatialTree = await api.properties.getSpatialStructure(
          modelID,
          true
        );
        addLog(
          `Retrieved spatial structure with root ID: ${spatialTree.expressID}`
        );

        // Extract elements
        const extractedElements = await extractModelElements(
          spatialTree,
          api,
          modelID,
          showAllElements
        );

        addLog(`Found ${extractedElements.length} elements with properties`);

        // Group elements by type
        const elementsByTypeMap: Record<string, IfcModelElement[]> = {};

        for (const element of extractedElements) {
          if (!elementsByTypeMap[element.type]) {
            elementsByTypeMap[element.type] = [];
          }
          elementsByTypeMap[element.type].push(element);
        }

        // Update state
        setElements(extractedElements);
        setElementsByType(elementsByTypeMap);

        // Calculate properties statistics
        const totalPropertySets = extractedElements.reduce(
          (total, element) => total + element.propertySets.length,
          0
        );

        const totalProperties = extractedElements.reduce(
          (total, element) =>
            total +
            element.propertySets.reduce(
              (setTotal, set) => setTotal + set.properties.length,
              0
            ),
          0
        );

        // Set success message
        setResult(
          `Successfully processed IFC file. Found ${extractedElements.length} elements with ${totalPropertySets} property sets and ${totalProperties} total properties.`
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        addLog(`Error processing spatial structure: ${errMsg}`);
        setError(`Error processing spatial structure: ${errMsg}`);
      }

      // Don't close the model here, as we need it for displaying properties
      // We'll clean it up when component is unmounted or a new file is loaded
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      addLog(`Error processing file: ${errorMessage}`);
      console.error("Error processing file:", error);
      setError(`Error: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }

  // Cleanup on unmount or when loading a new file
  React.useEffect(() => {
    return () => {
      if (ifcApi && modelID !== null) {
        try {
          ifcApi.CloseModel(modelID);
          addLog("Model closed and resources freed");
        } catch (error) {
          console.error("Error closing model:", error);
        }
      }
    };
  }, [ifcApi, modelID]);

  // Function to toggle logs view
  const toggleLogs = () => {
    setShowLogs(!showLogs);
  };

  // Function to toggle showing all elements
  const toggleShowAllElements = () => {
    setShowAllElements(!showAllElements);
  };

  // Function to toggle showing raw data
  const toggleShowRawData = () => {
    setShowRawData(!showRawData);
  };

  // Function to download element data as JSON
  const handleDownloadElements = () => {
    if (elements.length === 0) return;

    const jsonString = JSON.stringify(elements, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "ifc-elements-properties.json";
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Function to format property value
  const formatPropertyValue = (
    value: string | number | boolean | null
  ): string => {
    if (value === null) return "null";
    if (typeof value === "number") return value.toFixed(2);
    return String(value);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto border rounded-lg shadow-sm bg-white">
      <h2 className="text-2xl font-bold mb-4">
        IFC Model Elements & Properties
      </h2>

      <Script
        src="/wasm/web-ifc/web-ifc-api-iife.js"
        onLoad={() => setLoaded(true)}
        onError={() => setError("Failed to load IFC API script")}
        strategy="beforeInteractive"
      />

      <div className="mb-4">
        <input
          type="file"
          accept=".ifc"
          onChange={processFile}
          className="block w-full text-sm border border-gray-200 rounded p-2"
          disabled={loading}
        />
      </div>

      {!loaded && (
        <div className="p-3 bg-blue-50 text-blue-700 rounded mb-3">
          Loading WebIFC API...
        </div>
      )}

      {loading && (
        <div className="flex items-center p-4 bg-gray-50 rounded">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900 mr-2"></div>
          Processing file...
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded border-l-4 border-red-500 mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="p-4 bg-green-50 text-green-700 rounded border-l-4 border-green-500 mb-4">
          {result}
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <button
              onClick={toggleLogs}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              {showLogs ? "Hide Processing Logs" : "Show Processing Logs"}
            </button>
          </div>

          {showLogs && (
            <div className="bg-gray-900 p-4 rounded overflow-auto max-h-[30vh] border border-gray-800">
              <pre className="text-xs text-gray-100">{logs.join("\n")}</pre>
            </div>
          )}
        </div>
      )}

      {elements.length > 0 && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">Model Elements and Properties</h3>

            <div className="space-x-2">
              <button
                onClick={toggleShowAllElements}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                {showAllElements
                  ? "Show Physical Elements Only"
                  : "Show All Elements"}
              </button>

              <button
                onClick={handleDownloadElements}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Download JSON
              </button>
            </div>
          </div>

          {/* Element types with properties */}
          <div className="grid grid-cols-1 gap-6">
            {Object.keys(elementsByType).map((type) => (
              <div key={type} className="border rounded-lg shadow-sm p-4">
                <h4 className="font-bold text-lg mb-2 text-blue-800">
                  {type.replace("Ifc", "")}
                </h4>
                <p className="text-sm text-gray-500 mb-3">
                  Found {elementsByType[type].length} elements
                </p>

                {elementsByType[type].map((element) => (
                  <div key={element.id} className="mb-6 border-b pb-4">
                    <div className="flex justify-between mb-2">
                      <h5 className="font-semibold text-md">
                        {element.name}{" "}
                        <span className="text-gray-500 text-sm">
                          #{element.id}
                        </span>
                      </h5>
                    </div>

                    {element.propertySets.length === 0 ? (
                      <p className="text-sm text-gray-500 italic my-2">
                        No properties available
                      </p>
                    ) : (
                      <div className="mt-2">
                        <div className="text-sm text-gray-600 mb-2">
                          {element.propertySets.length} property sets with{" "}
                          {element.propertySets.reduce(
                            (total, set) => total + set.properties.length,
                            0
                          )}{" "}
                          properties
                        </div>

                        {element.propertySets.map((propSet, psIndex) => (
                          <div key={psIndex} className="mb-4">
                            <h6 className="font-medium text-sm text-gray-800 mb-1">
                              {propSet.name}
                            </h6>

                            <div className="overflow-x-auto">
                              <table className="min-w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50">
                                    <th className="px-4 py-2 text-left">
                                      Property
                                    </th>
                                    <th className="px-4 py-2 text-right">
                                      Value
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                  {propSet.properties.map((prop, propIndex) => (
                                    <tr
                                      key={propIndex}
                                      className="hover:bg-gray-50"
                                    >
                                      <td className="px-4 py-2">{prop.name}</td>
                                      <td className="px-4 py-2 text-right font-mono">
                                        {typeof prop.value === "boolean"
                                          ? prop.value
                                            ? "✓ Yes"
                                            : "✗ No"
                                          : formatPropertyValue(prop.value)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 mt-4">
            Showing {elements.length} elements with{" "}
            {elements.reduce(
              (total, el) =>
                total +
                el.propertySets.reduce(
                  (setTotal, set) => setTotal + set.properties.length,
                  0
                ),
              0
            )}{" "}
            total properties
          </p>
        </div>
      )}
    </div>
  );
}
