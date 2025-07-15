import { BookOpen, Trophy } from "lucide-react";

import React from 'react'

const FinishedState = ({currentMotivation, currentStudyTip, confirmReset}) => {
    return (
        <div className="flex items-center justify-center min-h-screen p-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
            <div className="w-full max-w-2xl text-center">
                <div className="border rounded-lg shadow-sm border-slate-700/50 bg-slate-800/50 backdrop-blur-sm">
                    <div className="px-4 py-8 sm:px-10 sm:py-10">
                        <div className="inline-flex items-center justify-center mb-6 rounded-full w-[4rem] h-[4rem] sm:w-20 sm:h-20 bg-green-600/20">
                            <Trophy className="w-6 h-6 text-green-400 lg:h-10 md:w-10" />
                        </div>

                        <h1 className="mb-4 text-[1rem] font-bold text-white sm:text-2xl">Exam Day is Here!</h1>

                        <div className="p-4 mb-8 border rounded-lg shadow-sm sm:p-6 border-slate-700/50 bg-slate-700/20">
                            <p className="text-[.75rem] italic leading-relaxed sm:text-sm text-slate-300">
                                <span className="not-italic font-semibold"></span> {currentMotivation}
                            </p>
                            <p className="text-[.75rem] italic leading-relaxed sm:text-sm text-slate-300 mt-2">
                                <span className="not-italic font-semibold"></span> {currentStudyTip}
                            </p>
                        </div>

                        <button
                            onClick={confirmReset}
                            className="inline-flex items-center justify-center w-full px-8 py-3 text-[.75rem] font-medium text-white transition-all duration-200 transform bg-indigo-600 rounded-md sm:text-sm whitespace-nowrap hover:bg-indigo-700 sm:w-max"
                        >
                            <BookOpen className="w-4 h-4 mr-2 sm:w-5 sm:h-5" />
                            Set New Countdown
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default FinishedState