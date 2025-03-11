"use client";

import { useState, useEffect } from "react";
import Script from "next/script";

// Define interfaces for TypeScript type safety
interface WebIFCApi {
  IfcAPI: new () => IfcAPI;
}

// Ensure we can access nested properties using a more flexible type
interface IfcProperty {
  value?: string | number;
  [key: string]: unknown;
}

interface IfcElement {
  type: string | number;
  Name?: IfcProperty;
  GlobalId?: IfcProperty;
  Quantities?: IfcProperty[];
  [key: string]: unknown;
}

interface IfcAPI {
  SetWasmPath(path: string, absolute?: boolean): void;
  Init(): Promise<void>;
  OpenModel(data: Uint8Array): number;
  GetAllLines(modelID: number): { size(): number; get(index: number): number };
  CloseModel(modelID: number): void;
  GetLine(modelID: number, expressID: number, flatten?: boolean): IfcElement;
  properties: {
    getPropertySets(
      modelID: number,
      elementID: number,
      recursive?: boolean
    ): Promise<IfcElement[]>;
    getItemProperties(
      modelID: number,
      elementID: number,
      recursive?: boolean
    ): Promise<IfcElement>;
    getTypeProperties(
      modelID: number,
      elementID: number,
      recursive?: boolean
    ): Promise<IfcElement[]>;
    getMaterialsProperties(
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

// Define an interface for the parsed element structure
interface ParsedElement {
  expressID: number;
  type: string | number;
  typeName?: string;
  name?: string;
  properties: Record<string, unknown>;
  quantities?: QuantitySet[];
  materials?: MaterialInfo[];
  typeProperties?: TypePropertyInfo[];
}

interface QuantitySet {
  name: string;
  quantities: Quantity[];
}

interface Quantity {
  name: string;
  value: number | string;
  unit?: string;
  type: string;
}

interface SpatialNode {
  expressID: number;
  type: string;
  children: SpatialNode[];
}

interface MaterialInfo {
  name: string;
  description?: string;
  properties?: Record<string, any>;
}

interface TypePropertyInfo {
  name: string;
  description?: string;
  properties?: Record<string, any>;
}

export default function SimpleIfcLoader() {
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileSelected, setFileSelected] = useState(false);
  const [parsedElements, setParsedElements] = useState<ParsedElement[]>([]);
  const [showJSON, setShowJSON] = useState(false);
  const [debugMode, setDebugMode] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [ifcSchema, setIfcSchema] = useState<Record<string, number>>({});
  const [inverseIfcSchema, setInverseIfcSchema] = useState<
    Record<number, string>
  >({});
  const [spatialStructure, setSpatialStructure] = useState<SpatialNode | null>(
    null
  );
  const [showSpatialView, setShowSpatialView] = useState(false);
  const [viewMode, setViewMode] = useState<
    "properties" | "materials" | "types" | "quantities"
  >("properties");

  // Function to add logs
  const addLog = (message: string) => {
    console.log(message);
    setLogs((prevLogs) => [...prevLogs, message]);
  };

  // Load IFC schema mapping when component loads
  useEffect(() => {
    async function loadIfcSchema() {
      try {
        const response = await fetch("/wasm/web-ifc/ifc-schema.js");
        if (!response.ok) {
          throw new Error("Failed to load schema");
        }

        const schemaText = await response.text();
        // Extract constants from the schema file
        const schemaMap: Record<string, number> = {};
        const inverseMap: Record<number, string> = {};

        // Use regex to extract constants
        const matches = schemaText.matchAll(/export const (\w+) = (\d+);/g);
        for (const match of matches) {
          const [_, name, value] = match;
          const numValue = parseInt(value, 10);
          schemaMap[name] = numValue;
          inverseMap[numValue] = name;
        }

        setIfcSchema(schemaMap);
        setInverseIfcSchema(inverseMap);
        addLog(
          `Loaded IFC schema with ${
            Object.keys(schemaMap).length
          } type definitions`
        );
      } catch (err) {
        console.error("Error loading IFC schema:", err);
        addLog(
          `Error loading IFC schema: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    loadIfcSchema();
  }, []);

  // Function to get type name from numeric ID
  const getTypeName = (typeCode: number): string => {
    if (inverseIfcSchema[typeCode]) {
      return inverseIfcSchema[typeCode];
    }
    return `Unknown Type (${typeCode})`;
  };

  // Once the script is loaded, check if WebIFC is available
  useEffect(() => {
    if (
      loaded &&
      typeof window !== "undefined" &&
      (window as unknown as { WebIFC?: WebIFCApi }).WebIFC
    ) {
      console.log("WebIFC loaded, ready to use");
    }
  }, [loaded]);

  async function processFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;

    setFileSelected(true);
    setResult(null);
    setError(null);
    setParsedElements([]);
    setShowJSON(false);
    setLogs([]);
    setSpatialStructure(null);

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
      const ifcAPI = new WebIFC.IfcAPI();

      // IMPORTANT: SetWasmPath expects a directory path where the wasm file is located
      // The second parameter (true) indicates this is an absolute path
      // This prevents the library from adding the origin URL again
      ifcAPI.SetWasmPath("/wasm/web-ifc/", true);

      addLog("Using WASM path (absolute): /wasm/web-ifc/");

      // Initialize the API
      await ifcAPI.Init();
      addLog("IFC API initialized successfully");

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      addLog(`File read successfully, size: ${arrayBuffer.byteLength} bytes`);

      // Open the model
      const modelID = ifcAPI.OpenModel(new Uint8Array(arrayBuffer));
      addLog(`Model opened with ID: ${modelID}`);

      // Try to get spatial structure
      try {
        const spatialTree = await ifcAPI.properties.getSpatialStructure(
          modelID,
          true
        );
        addLog(
          `Retrieved spatial structure with root ID: ${spatialTree.expressID}`
        );
        setSpatialStructure(spatialTree);
      } catch (err) {
        addLog(
          `Error getting spatial structure: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // Get all entities
      const allItems = ifcAPI.GetAllLines(modelID);
      addLog(`Total entities found: ${allItems.size()}`);

      // Get properties for a limited number of elements to avoid performance issues
      const elementsToShow = Math.min(allItems.size(), 100); // Increased to 100 elements
      addLog(`Will process first ${elementsToShow} elements`);
      const elements = [];
      let validElements = 0;
      let elementsWithType = 0;
      let elementsWithQuantities = 0;
      let elementsWithMaterials = 0;
      let elementsWithTypeProps = 0;

      for (let i = 0; i < elementsToShow; i++) {
        const expressID = allItems.get(i);
        try {
          // Get properties with flatten=true to resolve references
          const props = ifcAPI.GetLine(modelID, expressID, true);

          if (i < 5) {
            addLog(
              `Element ${expressID} raw properties: ${JSON.stringify(
                props
              ).substring(0, 200)}...`
            );
          }

          // Skip elements without a valid type property
          if (props.type === undefined || props.type === null) {
            if (i < 10)
              addLog(`Element ${expressID} skipped - no type property`);
            continue;
          }

          // Handle numeric type IDs
          let typeName = "Unknown Type";
          if (typeof props.type === "number") {
            typeName = getTypeName(props.type);
            if (i < 10)
              addLog(
                `Element ${expressID} has numeric type: ${props.type} (${typeName})`
              );
          } else if (typeof props.type === "string") {
            typeName = props.type;
            if (i < 10)
              addLog(`Element ${expressID} has string type: ${props.type}`);
          } else {
            if (i < 10)
              addLog(
                `Element ${expressID} has invalid type: ${typeof props.type}`
              );
            continue;
          }

          elementsWithType++;

          // Get element name
          let elementName: string;
          if (props.Name && props.Name.value !== undefined) {
            elementName = String(props.Name.value);
          } else if (props.GlobalId && props.GlobalId.value !== undefined) {
            elementName = String(props.GlobalId.value);
          } else {
            elementName = `Element #${expressID}`;
          }

          // Create the basic element object
          const element: ParsedElement = {
            expressID,
            type: props.type,
            typeName,
            properties: props,
            name: elementName,
          };

          // Try to get property sets and extract quantities
          try {
            addLog(`Getting property sets for element ${expressID}`);
            const propSets = await ifcAPI.properties.getPropertySets(
              modelID,
              expressID,
              true
            );

            if (!Array.isArray(propSets)) {
              addLog(`Property sets for ${expressID} is not an array`);
            } else {
              addLog(
                `Found ${propSets.length} property sets for element ${expressID}`
              );

              // Filter out quantity sets
              const quantitySets: QuantitySet[] = [];

              for (const pset of propSets) {
                // Check if this is a quantity set (IfcElementQuantity)
                if (
                  pset.type === "IFCELEMENTQUANTITY" ||
                  (typeof pset.type === "number" &&
                    getTypeName(pset.type) === "IFCELEMENTQUANTITY")
                ) {
                  addLog(
                    `Found IfcElementQuantity set for element ${expressID}`
                  );
                  const quantities: Quantity[] = [];

                  // Extract quantities from the set
                  if (!pset.Quantities) {
                    addLog(
                      `No Quantities property in IfcElementQuantity for element ${expressID}`
                    );
                  } else if (!Array.isArray(pset.Quantities)) {
                    addLog(
                      `Quantities property is not an array for element ${expressID}: ${typeof pset.Quantities}`
                    );
                  } else {
                    addLog(
                      `Found ${pset.Quantities.length} quantities in set for element ${expressID}`
                    );

                    for (const qProp of pset.Quantities) {
                      if (!qProp.type) {
                        if (i < 5)
                          addLog(
                            `Quantity has no type for element ${expressID}`
                          );
                        continue;
                      }

                      // Check if type is numeric or string
                      let qTypeName: string;
                      if (typeof qProp.type === "number") {
                        qTypeName = getTypeName(qProp.type);
                        if (!qTypeName.includes("IFCQUANTITY")) {
                          if (i < 5)
                            addLog(
                              `Quantity type is not IFCQUANTITY for element ${expressID}: ${qTypeName}`
                            );
                          continue;
                        }
                      } else if (
                        typeof qProp.type === "string" &&
                        !qProp.type.includes("IFCQUANTITY")
                      ) {
                        if (i < 5)
                          addLog(
                            `Quantity type is not IFCQUANTITY for element ${expressID}: ${qProp.type}`
                          );
                        continue;
                      }

                      // Different quantity types have different property names for values
                      let value: number | string = "Unknown";
                      let unit: string | undefined;

                      if (qProp.LengthValue !== undefined) {
                        value = Number(qProp.LengthValue);
                        unit = "m";
                      } else if (qProp.AreaValue !== undefined) {
                        value = Number(qProp.AreaValue);
                        unit = "m²";
                      } else if (qProp.VolumeValue !== undefined) {
                        value = Number(qProp.VolumeValue);
                        unit = "m³";
                      } else if (qProp.WeightValue !== undefined) {
                        value = Number(qProp.WeightValue);
                        unit = "kg";
                      } else if (qProp.CountValue !== undefined) {
                        value = Number(qProp.CountValue);
                        unit = "count";
                      }

                      let quantityName = "Unknown";
                      if (
                        qProp.Name &&
                        typeof qProp.Name === "object" &&
                        qProp.Name.value !== undefined
                      ) {
                        quantityName = String(qProp.Name.value);
                      }

                      quantities.push({
                        name: quantityName,
                        value,
                        unit,
                        type:
                          typeof qProp.type === "number"
                            ? getTypeName(qProp.type)
                            : String(qProp.type),
                      });

                      if (i < 5)
                        addLog(
                          `Added quantity ${quantityName} with value ${value} ${
                            unit || ""
                          } for element ${expressID}`
                        );
                    }
                  }

                  if (quantities.length > 0) {
                    let quantitySetName = "Unknown Quantity Set";
                    if (
                      pset.Name &&
                      typeof pset.Name === "object" &&
                      pset.Name.value !== undefined
                    ) {
                      quantitySetName = String(pset.Name.value);
                    }

                    quantitySets.push({
                      name: quantitySetName,
                      quantities,
                    });

                    addLog(
                      `Added quantity set ${quantitySetName} with ${quantities.length} quantities for element ${expressID}`
                    );
                  }
                }
              }

              if (quantitySets.length > 0) {
                element.quantities = quantitySets;
                elementsWithQuantities++;
                addLog(
                  `Element ${expressID} has ${quantitySets.length} quantity sets with data`
                );
              } else {
                addLog(`Element ${expressID} has no quantity sets`);
              }
            }
          } catch (err) {
            addLog(
              `Error getting quantities for element ${expressID}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }

          // Get material properties
          try {
            const materials = await ifcAPI.properties.getMaterialsProperties(
              modelID,
              expressID,
              true
            );
            if (Array.isArray(materials) && materials.length > 0) {
              elementsWithMaterials++;
              addLog(
                `Found ${materials.length} materials for element ${expressID}`
              );

              const materialInfos: MaterialInfo[] = materials.map(
                (material) => {
                  let name = "Unknown Material";
                  let description = undefined;

                  if (
                    material.Name &&
                    typeof material.Name === "object" &&
                    material.Name.value !== undefined
                  ) {
                    name = String(material.Name.value);
                  }

                  if (
                    material.Description &&
                    typeof material.Description === "object" &&
                    material.Description.value !== undefined
                  ) {
                    description = String(material.Description.value);
                  }

                  return {
                    name,
                    description,
                    properties: material,
                  };
                }
              );

              element.materials = materialInfos;
            }
          } catch (err) {
            addLog(
              `Error getting materials for element ${expressID}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }

          // Get type properties
          try {
            const typeProps = await ifcAPI.properties.getTypeProperties(
              modelID,
              expressID,
              true
            );
            if (Array.isArray(typeProps) && typeProps.length > 0) {
              elementsWithTypeProps++;
              addLog(
                `Found ${typeProps.length} type properties for element ${expressID}`
              );

              const typePropertyInfos: TypePropertyInfo[] = typeProps.map(
                (typeProp) => {
                  let name = "Unknown Type";
                  let description = undefined;

                  if (
                    typeProp.Name &&
                    typeof typeProp.Name === "object" &&
                    typeProp.Name.value !== undefined
                  ) {
                    name = String(typeProp.Name.value);
                  }

                  if (
                    typeProp.Description &&
                    typeof typeProp.Description === "object" &&
                    typeProp.Description.value !== undefined
                  ) {
                    description = String(typeProp.Description.value);
                  }

                  return {
                    name,
                    description,
                    properties: typeProp,
                  };
                }
              );

              element.typeProperties = typePropertyInfos;
            }
          } catch (err) {
            addLog(
              `Error getting type properties for element ${expressID}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }

          elements.push(element);
          validElements++;
          if (i < 5) addLog(`Added element ${expressID} to processed elements`);
        } catch (err) {
          addLog(
            `Error processing element ${expressID}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      addLog(
        `Processed ${validElements} valid elements out of ${elementsToShow} attempts`
      );
      addLog(`Found ${elementsWithType} elements with valid type property`);
      addLog(`Found ${elementsWithQuantities} elements with quantity data`);
      addLog(`Found ${elementsWithMaterials} elements with material data`);
      addLog(`Found ${elementsWithTypeProps} elements with type property data`);

      // Show elements based on filtering mode (include all in debug mode)
      const elementsWithData = debugMode
        ? elements
        : elements.filter((el) => {
            if (el.quantities && el.quantities.length > 0) {
              return true;
            }

            if (el.materials && el.materials.length > 0) {
              return true;
            }

            if (el.typeProperties && el.typeProperties.length > 0) {
              return true;
            }

            // Check type regardless of whether it's a number or string
            const elTypeName =
              typeof el.type === "number"
                ? getTypeName(el.type)
                : String(el.type);
            if (elTypeName.includes("IFC")) {
              return true;
            }

            return false;
          });

      addLog(
        `Final count after filtering: ${elementsWithData.length} elements`
      );

      // Sort elements by type for better organization
      elementsWithData.sort((a, b) => {
        const typeNameA =
          typeof a.type === "number" ? getTypeName(a.type) : String(a.type);
        const typeNameB =
          typeof b.type === "number" ? getTypeName(b.type) : String(b.type);
        return typeNameA.localeCompare(typeNameB);
      });

      setParsedElements(elementsWithData);

      // Set result
      setResult(
        `Successfully processed IFC file. Found ${allItems.size()} entities. Showing ${
          elementsWithData.length
        } elements with data.`
      );

      // Close the model to free memory
      ifcAPI.CloseModel(modelID);
      addLog("Model closed and resources freed");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog(`Error processing file: ${errorMessage}`);
      console.error("Error processing file:", err);
      setError(`Error: ${errorMessage}`);
    }
  }

  // Function to toggle JSON view
  const toggleJSONView = () => {
    setShowJSON(!showJSON);
  };

  // Function to toggle debug mode
  const toggleDebugMode = () => {
    setDebugMode(!debugMode);
  };

  // Function to toggle logs view
  const toggleLogs = () => {
    setShowLogs(!showLogs);
  };

  // Function to handle downloading the parsed elements as JSON
  const handleDownload = () => {
    if (parsedElements.length === 0) return;

    const jsonString = JSON.stringify(parsedElements, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "ifc-elements.json";
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Function to download logs
  const handleDownloadLogs = () => {
    if (logs.length === 0) return;

    const logsText = logs.join("\n");
    const blob = new Blob([logsText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "ifc-processing-logs.txt";
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Function to toggle spatial structure view
  const toggleSpatialView = () => {
    setShowSpatialView(!showSpatialView);
  };

  // Recursive function to render spatial structure tree
  const renderSpatialNode = (node: SpatialNode, level = 0) => {
    const typeName =
      typeof node.type === "number"
        ? getTypeName(node.type as number)
        : node.type;
    return (
      <div key={node.expressID} className="pl-4">
        <div className="flex items-center py-1">
          <span className="font-medium text-gray-700">
            {typeName} [{node.expressID}]
          </span>
        </div>
        {node.children && node.children.length > 0 && (
          <div className="pl-4 border-l border-gray-300">
            {node.children.map((child) => renderSpatialNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto border rounded-lg shadow-sm">
      <h2 className="text-2xl font-bold mb-4">Simple IFC File Loader</h2>

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
        />
      </div>

      {!loaded && (
        <div className="p-3 bg-blue-50 text-blue-700 rounded mb-3">
          Loading WebIFC API...
        </div>
      )}

      {fileSelected && !result && !error && (
        <div className="flex items-center p-4 bg-gray-50 rounded">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900 mr-2"></div>
          Processing file...
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded border-l-4 border-red-500">
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
            <button
              onClick={handleDownloadLogs}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Download Logs
            </button>
          </div>

          {showLogs && (
            <div className="bg-gray-900 p-4 rounded overflow-auto max-h-[30vh] border border-gray-800">
              <pre className="text-xs text-gray-100">{logs.join("\n")}</pre>
            </div>
          )}
        </div>
      )}

      {spatialStructure && (
        <div className="mt-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <button
              onClick={toggleSpatialView}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
            >
              {showSpatialView
                ? "Hide Spatial Structure"
                : "Show Spatial Structure"}
            </button>
          </div>

          {showSpatialView && (
            <div className="bg-white p-4 rounded overflow-auto max-h-[40vh] border border-gray-300">
              <h3 className="text-lg font-bold mb-2">
                Building Spatial Structure
              </h3>
              {renderSpatialNode(spatialStructure)}
            </div>
          )}
        </div>
      )}

      {parsedElements.length > 0 && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">IFC Elements with Data</h3>
            <div className="space-x-2">
              <button
                onClick={toggleDebugMode}
                className={`px-4 py-2 ${
                  debugMode ? "bg-red-600" : "bg-gray-600"
                } text-white rounded hover:bg-opacity-90 transition-colors`}
              >
                {debugMode ? "Debug Mode: ON" : "Debug Mode: OFF"}
              </button>
              <button
                onClick={toggleJSONView}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                {showJSON ? "Show Table View" : "Show JSON View"}
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Download JSON
              </button>
            </div>
          </div>

          {/* View Type Selector */}
          {!showJSON && (
            <div className="mb-4 flex border border-gray-200 rounded-md overflow-hidden">
              <button
                className={`flex-1 py-2 px-4 ${
                  viewMode === "properties"
                    ? "bg-blue-100 font-medium"
                    : "bg-white"
                }`}
                onClick={() => setViewMode("properties")}
              >
                Properties
              </button>
              <button
                className={`flex-1 py-2 px-4 ${
                  viewMode === "quantities"
                    ? "bg-blue-100 font-medium"
                    : "bg-white"
                }`}
                onClick={() => setViewMode("quantities")}
              >
                Quantities
              </button>
              <button
                className={`flex-1 py-2 px-4 ${
                  viewMode === "materials"
                    ? "bg-blue-100 font-medium"
                    : "bg-white"
                }`}
                onClick={() => setViewMode("materials")}
              >
                Materials
              </button>
              <button
                className={`flex-1 py-2 px-4 ${
                  viewMode === "types" ? "bg-blue-100 font-medium" : "bg-white"
                }`}
                onClick={() => setViewMode("types")}
              >
                Type Properties
              </button>
            </div>
          )}

          {!showJSON ? (
            <div className="overflow-auto max-h-[70vh] border border-gray-200 rounded">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      ID
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Type
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {viewMode === "properties" && "Properties"}
                      {viewMode === "quantities" && "Quantities"}
                      {viewMode === "materials" && "Materials"}
                      {viewMode === "types" && "Type Properties"}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {parsedElements.map((element) => (
                    <tr key={element.expressID} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {element.expressID}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {element.typeName ||
                          (typeof element.type === "number"
                            ? getTypeName(element.type)
                            : String(element.type))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {element.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {viewMode === "quantities" &&
                          (element.quantities ? (
                            <div className="space-y-2">
                              {element.quantities.map((qSet, qSetIndex) => (
                                <div
                                  key={qSetIndex}
                                  className="border-t border-gray-200 pt-2 first:border-t-0 first:pt-0"
                                >
                                  <p className="font-medium">{qSet.name}</p>
                                  <ul className="pl-4 mt-1 space-y-1">
                                    {qSet.quantities.map((q, qIndex) => (
                                      <li
                                        key={qIndex}
                                        className="flex justify-between"
                                      >
                                        <span>{q.name}:</span>
                                        <span className="font-medium">
                                          {q.value} {q.unit || ""}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">
                              No quantities
                            </span>
                          ))}

                        {viewMode === "materials" &&
                          (element.materials ? (
                            <div className="space-y-2">
                              {element.materials.map((material, index) => (
                                <div
                                  key={index}
                                  className="border-t border-gray-200 pt-2 first:border-t-0 first:pt-0"
                                >
                                  <p className="font-medium">{material.name}</p>
                                  {material.description && (
                                    <p className="text-xs text-gray-500">
                                      {material.description}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">
                              No material data
                            </span>
                          ))}

                        {viewMode === "types" &&
                          (element.typeProperties ? (
                            <div className="space-y-2">
                              {element.typeProperties.map((typeProp, index) => (
                                <div
                                  key={index}
                                  className="border-t border-gray-200 pt-2 first:border-t-0 first:pt-0"
                                >
                                  <p className="font-medium">{typeProp.name}</p>
                                  {typeProp.description && (
                                    <p className="text-xs text-gray-500">
                                      {typeProp.description}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">
                              No type properties
                            </span>
                          ))}

                        {viewMode === "properties" && (
                          <div>
                            <pre className="text-xs overflow-auto max-h-32">
                              {JSON.stringify(
                                element.properties,
                                null,
                                2
                              ).substring(0, 500)}
                              {JSON.stringify(element.properties, null, 2)
                                .length > 500 && "..."}
                            </pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-gray-900 p-4 rounded overflow-auto max-h-[70vh] border border-gray-800">
              <pre className="text-xs text-gray-100">
                {JSON.stringify(parsedElements, null, 2)}
              </pre>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Showing {parsedElements.length} elements from the IFC file
          </p>
        </div>
      )}
    </div>
  );
}
