import React from 'react'

const ConfirmResetModal = ({confirmReset, cancelReset}) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-70 backdrop-blur-sm">
            <div className="w-full max-w-md border rounded-lg shadow-xl border-slate-700/50 bg-slate-800/80">
                <div className="p-6">
                    <h3 className="mb-4 text-xl font-bold text-white">Confirm Reset</h3>
                    <p className="mb-6 text-slate-300">
                        Are you sure you want to reset the countdown? This action cannot be undone.
                    </p>
                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={cancelReset}
                            className="px-4 py-2 text-sm font-medium transition-all duration-200 rounded-md text-slate-300 hover:bg-slate-700/50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmReset}
                            className="px-4 py-2 text-sm font-medium text-white transition-all duration-200 bg-red-600 rounded-md hover:bg-red-700"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
    )
}

export default ConfirmResetModal