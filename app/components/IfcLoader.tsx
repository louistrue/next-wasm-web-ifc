"use client";

import { useState, useRef, useEffect } from "react";

// Define a custom type for our worker with URL property
interface WebIFCWorker extends Worker {
  _url?: string;
}

// Worker factory function
function createWorker(): WebIFCWorker | null {
  if (typeof window === "undefined") return null;

  // Create a blob with the worker code
  const workerCode = `
    // We're directly requiring web-ifc in the worker
    self.onmessage = async function(e) {
      try {
        if (e.data.type === 'init') {
          self.postMessage({ type: 'status', message: 'Initializing web-ifc...' });
          
          // Load the IFC library
          importScripts('${window.location.origin}/wasm/web-ifc/web-ifc-api-iife.js');
          
          // Initialize the IFC API
          const ifcAPI = new self.WebIFC.IfcAPI();
          
          // IMPORTANT: SetWasmPath expects a directory path where the wasm file is located
          // The second parameter (true) indicates this is an absolute path
          // This prevents the library from adding the origin URL again
          ifcAPI.SetWasmPath('/wasm/web-ifc/', true);
          
          await ifcAPI.Init();
          self.postMessage({ type: 'status', message: 'Web-IFC initialized' });
          
          self.ifcAPI = ifcAPI; // Store for later use
        }
        else if (e.data.type === 'processIFC') {
          if (!self.ifcAPI) {
            throw new Error('IFC API not initialized. Please call init first.');
          }
          
          self.postMessage({ type: 'status', message: 'Processing IFC file...' });
          
          // Process the IFC file
          const uint8Array = new Uint8Array(e.data.data);
          const modelID = self.ifcAPI.OpenModel(uint8Array);
          
          // Get all entities
          const allItems = self.ifcAPI.GetAllEntities(modelID);
          
          // Return the result
          self.postMessage({ 
            type: 'result', 
            modelID: modelID,
            entityCount: allItems.length 
          });
          
          // Close the model to free memory
          self.ifcAPI.CloseModel(modelID);
        }
      } catch (error) {
        self.postMessage({ 
          type: 'error', 
          message: error.message || 'Unknown error occurred' 
        });
      }
    };
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);

  const worker = new Worker(workerUrl) as WebIFCWorker;
  worker._url = workerUrl;

  return worker;
}

export default function IfcLoader() {
  const [modelInfo, setModelInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<WebIFCWorker | null>(null);

  // Initialize the worker
  useEffect(() => {
    return () => {
      // Clean up the worker when the component unmounts
      if (workerRef.current) {
        workerRef.current.terminate();
        if (workerRef.current._url) {
          URL.revokeObjectURL(workerRef.current._url);
        }
      }
    };
  }, []);

  function initWorker() {
    if (!workerRef.current) {
      // Create a new worker
      const worker = createWorker();

      if (!worker) {
        setError(
          "Failed to initialize worker - browser environment not available"
        );
        return;
      }

      workerRef.current = worker;

      // Handle messages from the worker
      workerRef.current.onmessage = (event) => {
        const { type, message, modelID, entityCount } = event.data;

        if (type === "status") {
          console.log(message);
        } else if (type === "result") {
          setModelInfo(`Model ID: ${modelID}, Entity Count: ${entityCount}`);
          setLoading(false);
        } else if (type === "error") {
          setError(message);
          setLoading(false);
        }
      };

      // Handle worker errors
      workerRef.current.onerror = (error) => {
        setLoading(false);
        setError(`Worker error: ${error.message}`);
      };

      // Initialize the worker
      workerRef.current.postMessage({ type: "init" });
    }
  }

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!event.target.files || event.target.files.length === 0) return;

    const file = event.target.files[0];
    setLoading(true);
    setError(null);
    setModelInfo(null);

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Initialize worker if not already done
      initWorker();

      // Process the file in the worker
      workerRef.current?.postMessage(
        {
          type: "processIFC",
          data: arrayBuffer,
        },
        [arrayBuffer]
      ); // Transfer array buffer to avoid copy
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-lg shadow-md">
      <h2 className="text-xl font-semibold mb-4">
        IFC Loader (Worker Version)
      </h2>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select an IFC file
        </label>
        <input
          type="file"
          accept=".ifc"
          onChange={handleFileUpload}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          disabled={loading}
        />
      </div>

      {loading && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded-md flex items-center">
          <svg
            className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-700"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          Processing IFC file...
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 border-l-4 border-red-700 rounded-md">
          <p className="font-medium">Error</p>
          <p>{error}</p>
        </div>
      )}

      {modelInfo && (
        <div className="p-3 bg-green-50 text-green-700 border-l-4 border-green-700 rounded-md">
          <p className="font-medium">Model Information</p>
          <p>{modelInfo}</p>
        </div>
      )}
    </div>
  );
}
