import { RotateCcw } from "lucide-react"

const ResetBtn = ({ handleReset }) => {
    return (
        <>
            {/* Reset Button && footer text*/}
            <div className="mb-12 text-right">
                <button
                    onClick={handleReset}
                    className="inline-flex items-center justify-center px-6 py-2 text-[.75rem] font-medium text-red-300 transition-all duration-200 bg-transparent border rounded-md border-red-500/50 hover:bg-red-600/20 whitespace-nowrap hover:bg-current/10"
                >
                    <RotateCcw className="w-3 h-3 mr-2" />
                    Reset
                </button>
            </div>

            <div className="mt-[5rem] mb-2 text-center">
                <p className="text-slate-500 text-[.8rem]">Built with ❤️ by TimmyStroge</p>
            </div>
        </>
    )
}

export default ResetBtn