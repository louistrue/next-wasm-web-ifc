import Link from "next/link";
import Image from "next/image";
import IfcBuiltElementsLoader from "./components/IfcBuiltElementsLoader";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-4 md:p-8 bg-gray-50">
      <header className="flex items-center mb-6 w-full">
        <div className="flex items-center mr-6">
          <Image
            src="/next.svg"
            alt="Next.js Logo"
            width={100}
            height={24}
            priority
          />
          <span className="mx-4 text-gray-400">+</span>
          <h1 className="text-xl font-bold">IFC Loader</h1>
        </div>
      </header>

      <div className="container mx-auto w-full">
        <IfcBuiltElementsLoader />
      </div>

      <footer className="mt-8 py-4 text-center w-full">
        <div className="flex flex-col md:flex-row justify-center items-center space-y-2 md:space-y-0 md:space-x-4">
          <a
            href="https://nextjs.org/docs"
            className="flex items-center text-sm text-gray-600 hover:text-gray-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              src="/next.svg"
              alt="Next.js Logo"
              className="mr-2"
              width={16}
              height={16}
              priority
            />
            Next.js Docs
          </a>
          <a
            href="https://ifcjs.github.io/info/"
            className="flex items-center text-sm text-gray-600 hover:text-gray-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg
              className="w-4 h-4 mr-2"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
            Web IFC Documentation
          </a>
        </div>
      </footer>
    </main>
  );
}
