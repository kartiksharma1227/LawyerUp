import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { firebaseAuth } from "../context/firebase"; // keep same import pattern
import ProfileMenu from "./ProfileMenu";

// UploadCaseFile: uploads a PDF to the Flask backend /api/v1/upload-case-file
// Design intentionally matches the Chatbot component (colors, layout, ProfileMenu)
export default function UploadCaseFile() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [userUID, setUserUID] = useState(null);
  const [idToken, setIdToken] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [responseData, setResponseData] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsubscribe = firebaseAuth.onAuthStateChanged(async (user) => {
      if (user) {
        setUserUID(user.uid);
        try {
          const token = await user.getIdToken();
          setIdToken(token);
        } catch (err) {
          console.error("Failed to get ID token:", err);
          setError("Failed to authenticate. Please sign in again.");
        }
      } else {
        setUserUID(null);
        setIdToken(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const onFileChange = (e) => {
    setError(null);
    const f = e.target.files?.[0] || null;
    if (f && f.name && f.name.toLowerCase().endsWith(".pdf")) {
      setSelectedFile(f);
    } else if (f) {
      setError("Only PDF files are supported.");
      setSelectedFile(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        setError("Only PDF files are supported.");
        return;
      }
      setSelectedFile(f);
      setError(null);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setProgress(0);
    setResponseData(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  const uploadFile = async () => {
    setError(null);
    setResponseData(null);

    if (!idToken) {
      setError("You must be signed in to upload a case file.");
      return;
    }

    if (!selectedFile) {
      setError("Please select a PDF to upload.");
      return;
    }

    const form = new FormData();
    form.append("file", selectedFile);

    try {
      setUploading(true);
      setProgress(0);

      const resp = await axios.post(
        (process.env.REACT_APP_API_BASE_URL || "http://127.0.0.1:8082") + "/api/v1/upload-case-file",
        form,
        {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${idToken}`,
          },
          onUploadProgress: (evt) => {
            if (evt.total) {
              const pct = Math.round((evt.loaded / evt.total) * 100);
              setProgress(pct);
            }
          },
          timeout: 120000, // 2 minutes; adjust as needed
        }
      );

      setResponseData(resp.data || null);
    } catch (err) {
      console.error("Upload error:", err);
      if (err.response?.data?.error) setError(err.response.data.error);
      else setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#343541] text-white">
      {/* Sidebar - simplified to match request: remove "Signed in as" */}
      <aside className="w-64 bg-[#F0F8F8] border-r-3 border-teal-600 flex flex-col">
        <div className="p-4 border-b bg-teal-600 border-teal-600 text-center text-lg font-bold text-white">
          Case Monitor
        </div>

        <div className="p-6 border-b border-teal-600">
          <button
            onClick={clearSelection}
            className="w-full flex items-center justify-center gap-2 p-3 bg-teal-600 hover:bg-teal-700 rounded-md text-white font-medium transition-all duration-200 shadow-sm hover:shadow-md"
          >
            Clear
          </button>
        </div>

        {/* intentionally empty space to keep sidebar minimal and not show user id */}
        <div className="flex-1" />
      </aside>

      {/* Main area */}
      <div className="flex flex-col flex-1 bg-[#F0F8F8]">
        <header className="relative p-4 bg-teal-600 text-white flex justify-center items-center shadow-md">
          <h1 className="text-lg font-semibold">Upload Case File</h1>
          <div className="absolute right-4">
            <ProfileMenu />
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-3xl mx-auto bg-white rounded-lg p-6 shadow-md text-gray-800">
            <p className="mb-6 text-center">
              Upload a PDF of the case documents. The backend will extract legal entities,
              index the document, and prepare monitoring terms.
            </p>

            {/* Card content centered vertically for the drop area and upload controls */}
            <div className="flex flex-col items-center gap-6">
              {/* Drag & drop area */}
              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                className="w-full border-2 border-dashed border-teal-200 rounded-md p-8 mb-2 text-center cursor-pointer bg-white"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={onFileChange}
                />

                {!selectedFile ? (
                  <div>
                    <div className="text-xl font-semibold">Drop PDF here, or click to select</div>
                    <div className="text-sm text-gray-500 mt-2">Only PDF files are supported</div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="font-semibold">{selectedFile.name}</div>
                    <div className="text-sm text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
                    <div className="mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          clearSelection();
                        }}
                        className="px-3 py-1 bg-red-500 rounded text-white"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Upload button centered inside the card */}
              <div className="w-full flex flex-col items-center">
                <button
                  onClick={uploadFile}
                  disabled={uploading}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-700 rounded-md text-white disabled:opacity-50 transition-shadow shadow-sm"
                >
                  {uploading ? "Uploading..." : "Upload PDF"}
                </button>

                {/* Progress bar: full width, centered */}
                <div className="w-full mt-4">
                  <div className="flex items-center justify-between mb-2 text-sm text-gray-600">
                    <div>Progress</div>
                    <div className="text-xs text-gray-500">{progress}%</div>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      style={{ width: `${progress}%` }}
                      className="h-full bg-teal-600 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Response / Error */}
              <div className="w-full mt-6">
                {error && (
                  <div className="p-3 bg-red-100 text-red-800 rounded-md">{error}</div>
                )}

                {responseData && (
                  <div className="p-4 bg-green-50 rounded-md text-gray-800">
                    <div className="font-semibold mb-2">Upload successful</div>
                    <div><strong>Document:</strong> {responseData.doc_name}</div>
                    <div><strong>Extracted terms:</strong> {responseData.extracted_terms_count}</div>
                    <div><strong>Chunks indexed:</strong> {responseData.chunks_indexed}</div>

                    {Array.isArray(responseData.extracted_terms) && (
                      <div className="mt-3">
                        <div className="font-medium">Top extracted terms</div>
                        <ul className="list-disc list-inside text-sm">
                          {responseData.extracted_terms.slice(0, 8).map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Small note */}
              <div className="mt-4 text-xs text-gray-500 text-center w-full">
                Files are uploaded to the backend for processing. Make sure you are signed in.
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
