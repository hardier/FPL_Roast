import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trophy, ArrowRightLeft, AlertCircle, ChevronRight, User, Shield, Zap } from 'lucide-react';
import { fetchBootstrap, fetchTeamHistory, fetchTeamTransfers, fetchEventPicks } from './services/fplService';
import { generateRoast } from './services/geminiService';
import { BootstrapData, HistoryEvent, Transfer, EventPicks, Player } from './types';

export default function App() {
  const [teamId, setTeamId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [bootstrapData, setBootstrapData] = useState<BootstrapData | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  
  const [selectedGw, setSelectedGw] = useState<number | null>(null);
  const [gwPicks, setGwPicks] = useState<EventPicks | null>(null);
  const [gwTransfers, setGwTransfers] = useState<Transfer[]>([]);
  
  const [roast, setRoast] = useState<{ zh: string; en: string } | null>(null);
  const [roasting, setRoasting] = useState(false);
  const [roastCache, setRoastCache] = useState<Record<string, { zh: string; en: string }>>({});
  const [roastLang, setRoastLang] = useState<'zh' | 'en'>('zh');
  const [transferValueGain, setTransferValueGain] = useState<number | null>(null);
  const [appMode, setAppMode] = useState<'roast' | 'compliment'>('roast');
  const currentGwRequestRef = React.useRef<number | null>(null);

  const init = async () => {
    setIsInitializing(true);
    setError(null);
    try {
      const data = await fetchBootstrap();
      setBootstrapData(data);
    } catch (err: any) {
      console.error('Failed to load bootstrap data', err);
      setError(`Failed to initialize: ${err.message}. This is usually because FPL API is blocking the server. Please try refreshing or clicking retry.`);
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    init();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamId || !bootstrapData) return;
    
    setLoading(true);
    setError(null);
    setHistory([]);
    setSelectedGw(null);
    setRoast(null);
    
    try {
      const id = parseInt(teamId, 10);
      const [historyData, transfersData] = await Promise.all([
        fetchTeamHistory(id),
        fetchTeamTransfers(id)
      ]);
      
      const currentHistory = [...(historyData.current || [])].reverse();
      setHistory(currentHistory); // Show latest first
      setTransfers(transfersData || []);
      
      // Start background generation for recent 3 GWs to avoid quota issues
      runBackgroundJobs(id, currentHistory.slice(0, 3), transfersData || [], bootstrapData, appMode);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch team data. Please check your Team ID.');
    } finally {
      setLoading(false);
    }
  };

  const runBackgroundJobs = async (id: number, historyList: HistoryEvent[], transfersList: Transfer[], bootstrap: BootstrapData, mode: 'roast' | 'compliment') => {
    for (const gw of historyList) {
      try {
        // Check if already cached
        const cacheRes = await fetch(`/api/cache/roast?teamId=${id}&gw=${gw.event}&mode=${mode}`);
        if (cacheRes.ok) continue;

        // Need to calculate gain
        const gwTransfersList = transfersList.filter(t => t.event === gw.event);
        let gain = null;
        if (gwTransfersList.length > 0) {
          const liveRes = await fetch(`/api/fpl/event/${gw.event}/live`);
          if (liveRes.ok) {
             const liveData = await liveRes.json();
             let inPoints = 0, outPoints = 0;
             gwTransfersList.forEach(t => {
                const pIn = liveData.elements.find((e: any) => e.id === t.element_in);
                const pOut = liveData.elements.find((e: any) => e.id === t.element_out);
                if (pIn) inPoints += pIn.stats.total_points;
                if (pOut) outPoints += pOut.stats.total_points;
             });
             gain = inPoints - outPoints - gw.event_transfers_cost;
          }
        }

        const playersIn = gwTransfersList.map(t => bootstrap?.elements.find(e => e.id === t.element_in)?.web_name || 'Unknown');
        const playersOut = gwTransfersList.map(t => bootstrap?.elements.find(e => e.id === t.element_out)?.web_name || 'Unknown');

        // Call generateRoast (which handles the caching internally now)
        await generateRoast(id, gw.event, gw.points, playersIn, playersOut, gw.event_transfers_cost, gain, mode);
        
        // Sleep longer to avoid rate limiting (8s for background jobs)
        await new Promise(resolve => setTimeout(resolve, 8000));
      } catch (e) {
        console.error(`Background job failed for GW ${gw.event}`, e);
      }
    }
  };

  const handleSelectGw = async (gw: number) => {
    if (!teamId || !bootstrapData) return;
    currentGwRequestRef.current = gw;
    setSelectedGw(gw);
    setRoast(null);
    setTransferValueGain(null);
    
    try {
      const id = parseInt(teamId, 10);
      const picks = await fetchEventPicks(id, gw);
      if (currentGwRequestRef.current !== gw) return;
      setGwPicks(picks);
      
      const gwTransfersList = transfers.filter(t => t.event === gw);
      setGwTransfers(gwTransfersList);

      const gwHistory = history.find(h => h.event === gw);
      const cost = gwHistory?.event_transfers_cost || 0;

      // Calculate transfer value gain
      let gain = null;
      if (gwTransfersList.length > 0) {
        let inPoints = 0;
        let outPoints = 0;

        const liveRes = await fetch(`/api/fpl/event/${gw}/live`);
        if (currentGwRequestRef.current !== gw) return;
        if (liveRes.ok) {
           const liveData = await liveRes.json();
           
           gwTransfersList.forEach(t => {
              const playerInLive = liveData.elements.find((e: any) => e.id === t.element_in);
              const playerOutLive = liveData.elements.find((e: any) => e.id === t.element_out);
              
              if (playerInLive) inPoints += playerInLive.stats.total_points;
              if (playerOutLive) outPoints += playerOutLive.stats.total_points;
           });
           
           gain = inPoints - outPoints - cost;
        }
      }
      setTransferValueGain(gain);

      // Auto-generate roast if not cached
      const cacheKey = `${gw}_${appMode}`;
      if (roastCache[cacheKey]) {
        setRoast(roastCache[cacheKey]);
      } else {
        generateAndSetRoast(gw, gwHistory?.points || 0, gwTransfersList, cost, gain);
      }

    } catch (err) {
      console.error('Failed to fetch GW data', err);
    }
  };

  const generateAndSetRoast = async (gw: number, points: number, gwTransfersList: Transfer[], cost: number, gain: number | null, overrideMode?: 'roast' | 'compliment') => {
    if (currentGwRequestRef.current !== gw) return;
    setRoasting(true);
    const mode = overrideMode || appMode;
    try {
      const playersIn = gwTransfersList.map(t => {
        const p = bootstrapData?.elements.find(e => e.id === t.element_in);
        return p ? p.web_name : 'Unknown';
      });
      
      const playersOut = gwTransfersList.map(t => {
        const p = bootstrapData?.elements.find(e => e.id === t.element_out);
        return p ? p.web_name : 'Unknown';
      });
      
      const roastText = await generateRoast(parseInt(teamId, 10), gw, points, playersIn, playersOut, cost, gain, mode);
      if (currentGwRequestRef.current !== gw) return;
      setRoast(roastText);
      setRoastCache(prev => ({ ...prev, [`${gw}_${mode}`]: roastText }));
    } catch (err) {
      if (currentGwRequestRef.current !== gw) return;
      setRoast({ zh: '生成吐槽失败。AI被你的烂操作震惊到无语了。', en: 'Failed to generate roast. The AI is speechless.' });
    } finally {
      if (currentGwRequestRef.current === gw) {
        setRoasting(false);
      }
    }
  };

  const handleRoast = async () => {
    if (!selectedGw || !gwPicks || !bootstrapData) return;
    const gwHistory = history.find(h => h.event === selectedGw);
    generateAndSetRoast(selectedGw, gwHistory?.points || 0, gwTransfers, gwHistory?.event_transfers_cost || 0, transferValueGain);
  };

  const getPlayerName = (id: number) => {
    return bootstrapData?.elements.find(e => e.id === id)?.web_name || 'Unknown';
  };

  const getPlayerPosition = (id: number) => {
    const type = bootstrapData?.elements.find(e => e.id === id)?.element_type;
    switch(type) {
      case 1: return 'GK';
      case 2: return 'DEF';
      case 3: return 'MID';
      case 4: return 'FWD';
      default: return 'UNK';
    }
  };

  const handleSecretClick = () => {
    const newMode = appMode === 'roast' ? 'compliment' : 'roast';
    setAppMode(newMode);
    setRoast(null); 
    
    if (selectedGw) {
      const cacheKey = `${selectedGw}_${newMode}`;
      if (roastCache[cacheKey]) {
        setRoast(roastCache[cacheKey]);
      } else {
        const gwHistory = history.find(h => h.event === selectedGw);
        const gwTransfersList = transfers.filter(t => t.event === selectedGw);
        // We pass the newMode explicitly to avoid stale state issues
        generateAndSetRoast(selectedGw, gwHistory?.points || 0, gwTransfersList, gwHistory?.event_transfers_cost || 0, transferValueGain, newMode);
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">
      <div className="max-w-5xl mx-auto px-4 py-12">
        <header className="mb-12 text-center">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center p-3 bg-emerald-500/10 rounded-2xl mb-6 cursor-pointer"
            onClick={handleSecretClick}
            title="Secret Mode Toggle"
          >
            <Shield className={`w-8 h-8 ${appMode === 'compliment' ? 'text-pink-400' : 'text-emerald-400'}`} />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
          >
            FPL <span className={appMode === 'compliment' ? 'text-pink-400' : 'text-emerald-400'}>{appMode === 'compliment' ? 'Praise' : 'Roast'}</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-zinc-400 max-w-lg mx-auto"
          >
            Enter your Fantasy Premier League Team ID to review your gameweeks and get {appMode === 'compliment' ? 'brilliantly praised' : 'brutally roasted'} by AI for your transfer decisions.
          </motion.p>
        </header>

        {!history.length && (
          <motion.form 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            onSubmit={handleSearch} 
            className="max-w-md mx-auto"
          >
            <div className="relative">
              <input
                type="text"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="Enter your FPL Team ID (e.g. 123456)"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-4 pl-12 pr-4 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            </div>
            <button
              type="submit"
              disabled={loading || isInitializing || !teamId.trim() || !bootstrapData}
              className="w-full mt-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold py-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isInitializing ? 'Initializing...' : loading ? 'Fetching Data...' : 'Analyze My Team'}
              {!loading && !isInitializing && <ChevronRight className="w-5 h-5" />}
            </button>
            {error && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl space-y-3 text-red-400">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">{error}</p>
                </div>
                {!bootstrapData && !loading && (
                  <button 
                    onClick={(e) => { e.preventDefault(); init(); }}
                    className="text-xs bg-red-500/20 hover:bg-red-500/30 px-3 py-1.5 rounded-lg transition-colors font-medium border border-red-500/30"
                  >
                    Retry Initialization
                  </button>
                )}
              </div>
            )}
          </motion.form>
        )}

        {history.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Sidebar: Gameweek List */}
            <div className="lg:col-span-4 space-y-4">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Gameweeks</h2>
                <button 
                  onClick={() => { setHistory([]); setSelectedGw(null); setTeamId(''); }}
                  className="text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  Change Team
                </button>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {history.map((gw) => (
                  <button
                    key={gw.event}
                    onClick={() => handleSelectGw(gw.event)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selectedGw === gw.event 
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
                        : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium">Gameweek {gw.event}</span>
                      <span className="text-sm font-mono">{gw.points} pts</span>
                    </div>
                    <div className="flex justify-between items-center text-xs opacity-70">
                      <span>Rank: {gw.rank?.toLocaleString() || 'N/A'}</span>
                      <span>{gw.event_transfers} transfers</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Main Content: Gameweek Details */}
            <div className="lg:col-span-8">
              <AnimatePresence mode="wait">
                {selectedGw ? (
                  <motion.div
                    key={selectedGw}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    {/* Header Stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                        <div className="text-zinc-500 text-sm mb-1">GW Points</div>
                        <div className="text-3xl font-mono text-white">{history.find(h => h.event === selectedGw)?.points}</div>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                        <div className="text-zinc-500 text-sm mb-1">Transfers</div>
                        <div className="text-3xl font-mono text-white">{history.find(h => h.event === selectedGw)?.event_transfers}</div>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                        <div className="text-zinc-500 text-sm mb-1">Transfer Value Gain</div>
                        <div className={`text-3xl font-mono ${transferValueGain !== null ? (transferValueGain > 0 ? 'text-emerald-400' : transferValueGain < 0 ? 'text-red-400' : 'text-white') : 'text-zinc-600'}`}>
                          {transferValueGain !== null ? (transferValueGain > 0 ? `+${transferValueGain}` : transferValueGain) : '-'}
                        </div>
                      </div>
                    </div>

                    {/* Transfers Section */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="p-6 border-b border-zinc-800 flex items-center gap-3">
                        <ArrowRightLeft className="w-5 h-5 text-zinc-400" />
                        <h3 className="text-lg font-semibold">Transfers Made</h3>
                      </div>
                      <div className="p-6">
                        {gwTransfers.length > 0 ? (
                          <div className="space-y-4">
                            {gwTransfers.map((t, i) => (
                              <div key={i} className="flex items-center justify-between bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                                <div className="flex items-center gap-3 text-red-400 w-1/2">
                                  <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                                    <ArrowRightLeft className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <div className="font-medium">{getPlayerName(t.element_out)}</div>
                                    <div className="text-xs opacity-70">Out</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 text-emerald-400 w-1/2 justify-end text-right">
                                  <div>
                                    <div className="font-medium">{getPlayerName(t.element_in)}</div>
                                    <div className="text-xs opacity-70">In</div>
                                  </div>
                                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                    <ArrowRightLeft className="w-4 h-4" />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-zinc-500">
                            No transfers made this gameweek.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Roast Section */}
                    <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden relative">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-cyan-500"></div>
                      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Zap className={`w-5 h-5 ${appMode === 'compliment' ? 'text-pink-400' : 'text-emerald-400'}`} />
                          <h3 className="text-lg font-semibold">{appMode === 'compliment' ? 'AI Praise' : 'AI Roast'}</h3>
                        </div>
                        <div className="flex items-center gap-2">
                          {roast && (
                            <button
                              onClick={() => setRoastLang(l => l === 'zh' ? 'en' : 'zh')}
                              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                            >
                              {roastLang === 'zh' ? '🇺🇸 English' : '🇨🇳 中文'}
                            </button>
                          )}
                          <button
                            onClick={handleRoast}
                            disabled={roasting}
                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            {roasting ? 'Generating...' : roast ? (appMode === 'compliment' ? 'Praise Again' : 'Roast Again') : (appMode === 'compliment' ? 'Praise My Transfers' : 'Roast My Transfers')}
                          </button>
                        </div>
                      </div>
                      <div className="p-6 min-h-[150px] flex items-center justify-center">
                        {roasting ? (
                          <div className="flex flex-col items-center gap-4 text-zinc-500">
                            <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${appMode === 'compliment' ? 'border-pink-500' : 'border-emerald-500'}`}></div>
                            <p className="text-sm">{appMode === 'compliment' ? 'Preparing compliments...' : 'Analyzing your terrible decisions...'}</p>
                          </div>
                        ) : roast ? (
                          <div className="prose prose-invert max-w-none">
                            <p className="text-lg leading-relaxed text-zinc-300 italic">{roast[roastLang]}</p>
                          </div>
                        ) : (
                          <div className="text-zinc-500 text-center">
                            {appMode === 'compliment' ? 'Click the button above to let the AI praise your brilliant FPL management skills.' : 'Click the button above to let the AI brutally judge your FPL management skills.'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Lineup Section */}
                    {gwPicks && (
                      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                        <div className="p-6 border-b border-zinc-800 flex items-center gap-3">
                          <User className="w-5 h-5 text-zinc-400" />
                          <h3 className="text-lg font-semibold">Starting XI & Bench</h3>
                        </div>
                        <div className="p-6">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {gwPicks.picks.map((pick) => (
                              <div 
                                key={pick.element} 
                                className={`flex items-center justify-between p-3 rounded-xl border ${
                                  pick.position <= 11 
                                    ? 'bg-zinc-950 border-zinc-800' 
                                    : 'bg-zinc-900/50 border-zinc-800/50 opacity-60'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-xs font-mono text-zinc-400">
                                    {getPlayerPosition(pick.element)}
                                  </div>
                                  <div>
                                    <div className="font-medium flex items-center gap-2">
                                      {getPlayerName(pick.element)}
                                      {pick.is_captain && <span className="text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">C</span>}
                                      {pick.is_vice_captain && <span className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-bold">V</span>}
                                    </div>
                                    <div className="text-xs text-zinc-500">
                                      {pick.position <= 11 ? 'Starting' : `Bench ${pick.position - 11}`}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center text-zinc-500 py-20 border border-dashed border-zinc-800 rounded-2xl"
                  >
                    <Trophy className="w-12 h-12 mb-4 opacity-20" />
                    <p>Select a gameweek from the sidebar to view details.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
