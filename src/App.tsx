import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trophy, ArrowRightLeft, AlertCircle, ChevronRight, User, Shield, Zap, Flame, Heart } from 'lucide-react';
import { fetchBootstrap, fetchTeamHistory, fetchTeamTransfers, fetchEventPicks } from './services/fplService';
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
  
  // Initialize language based on URL path
  const initialLang = window.location.pathname.startsWith('/en') ? 'en' : 'zh';
  const [roastLang, setRoastLang] = useState<'zh' | 'en'>(initialLang);
  
  const [transferValueGain, setTransferValueGain] = useState<number | null>(null);
  const [appMode, setAppMode] = useState<'roast' | 'compliment'>('roast');
  const [gwLivePoints, setGwLivePoints] = useState<Record<number, number>>({});
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
      
      // Trigger background sync for all GWs
      fetch(`/api/sync/${id}`, { method: 'POST' }).catch(console.error);

      const [historyData, transfersData] = await Promise.all([
        fetchTeamHistory(id),
        fetchTeamTransfers(id)
      ]);
      
      const currentHistory = [...(historyData.current || [])].reverse();
      setHistory(currentHistory); // Show latest first
      setTransfers(transfersData || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch team data. Please check your Team ID.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGw = async (gw: number) => {
    if (!teamId || !bootstrapData) return;
    currentGwRequestRef.current = gw;
    setSelectedGw(gw);
    setRoast(null);
    setTransferValueGain(null);
    setGwLivePoints({}); // Clear old points to avoid flashing
    
    try {
      const id = parseInt(teamId, 10);
      
      // Fetch picks and live data in parallel for better performance
      const [picks, liveRes] = await Promise.all([
        fetchEventPicks(id, gw),
        fetch(`/api/fpl/event/${gw}/live`)
      ]);

      if (currentGwRequestRef.current !== gw) return;
      setGwPicks(picks);
      
      // Process live points
      const pointsMap: Record<number, number> = {};
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        liveData.elements.forEach((el: any) => {
          pointsMap[el.id] = el.stats.total_points;
        });
        setGwLivePoints(pointsMap);
      }

      const gwTransfersList = transfers.filter(t => t.event === gw);
      setGwTransfers(gwTransfersList);

      const gwHistory = history.find(h => h.event === gw);
      const cost = gwHistory?.event_transfers_cost || 0;

      // Calculate transfer value gain
      let gain = null;
      if (gwTransfersList.length > 0 && Object.keys(pointsMap).length > 0) {
        let inPoints = 0;
        let outPoints = 0;
        
        gwTransfersList.forEach(t => {
          inPoints += pointsMap[t.element_in] || 0;
          outPoints += pointsMap[t.element_out] || 0;
        });
        
        gain = inPoints - outPoints - cost;
      }
      setTransferValueGain(gain);

      // Auto-generate roast if not cached
      const cacheKey = `${gw}_${appMode}`;
      if (roastCache[cacheKey]) {
        setRoast(roastCache[cacheKey]);
      } else {
        generateAndSetRoast(gw);
      }

    } catch (err) {
      console.error('Failed to fetch GW data', err);
    }
  };

  const generateAndSetRoast = async (gw: number, overrideMode?: 'roast' | 'compliment') => {
    if (currentGwRequestRef.current !== gw) return;
    setRoasting(true);
    const mode = overrideMode || appMode;
    
    try {
      const res = await fetch(`/api/roast?teamId=${teamId}&gw=${gw}&mode=${mode}`);
      if (!res.ok) throw new Error('Failed to generate roast');
      
      const roastText = await res.json();
      
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
    if (!selectedGw) return;
    generateAndSetRoast(selectedGw);
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

  const getJerseyUrl = (playerId: number) => {
    const player = bootstrapData?.elements.find(e => e.id === playerId);
    if (!player) return null;
    
    // Goalkeepers have a different jersey (suffix _1)
    const isGk = player.element_type === 1;
    return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${player.team_code}${isGk ? '_1' : ''}-66.webp`;
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
        // We pass the newMode explicitly to avoid stale state issues
        generateAndSetRoast(selectedGw, newMode);
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
            className={`inline-flex items-center justify-center p-3 rounded-2xl mb-6 cursor-pointer transition-colors ${appMode === 'compliment' ? 'bg-pink-500/10 hover:bg-pink-500/20' : 'bg-emerald-500/10 hover:bg-emerald-500/20'}`}
            onClick={handleSecretClick}
            title="Secret Mode Toggle"
          >
            {appMode === 'compliment' ? (
              <Heart className="w-8 h-8 text-pink-400 fill-pink-400/20" />
            ) : (
              <Flame className="w-8 h-8 text-emerald-400 fill-emerald-400/20" />
            )}
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
              <div className="flex items-center justify-between mb-4 lg:mb-6">
                <h2 className="text-xl font-semibold">Gameweeks</h2>
                <button 
                  onClick={() => { setHistory([]); setSelectedGw(null); setTeamId(''); }}
                  className="text-sm text-zinc-400 hover:text-white transition-colors bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800"
                >
                  Change Team
                </button>
              </div>
              <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto lg:max-h-[600px] pb-4 lg:pb-0 pr-2 custom-scrollbar snap-x">
                {history.map((gw) => (
                  <button
                    key={gw.event}
                    onClick={() => handleSelectGw(gw.event)}
                    className={`flex-shrink-0 w-56 lg:w-full text-left p-4 rounded-xl border transition-all snap-start ${
                      selectedGw === gw.event 
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
                        : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2 gap-2">
                      <span className="font-medium whitespace-nowrap">Gameweek {gw.event}</span>
                      <span className="text-sm font-mono whitespace-nowrap">{gw.points} pts</span>
                    </div>
                    <div className="flex justify-between items-center text-xs opacity-70 gap-2">
                      <span className="truncate">Rank: {gw.rank?.toLocaleString() || 'N/A'}</span>
                      <span className="whitespace-nowrap">{gw.event_transfers} transfers</span>
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                      <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-2xl">
                        <div className="text-zinc-500 text-xs sm:text-sm mb-1">GW Points</div>
                        <div className="text-2xl sm:text-3xl font-mono text-white">{history.find(h => h.event === selectedGw)?.points}</div>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-2xl">
                        <div className="text-zinc-500 text-xs sm:text-sm mb-1">Transfers</div>
                        <div className="text-2xl sm:text-3xl font-mono text-white">{history.find(h => h.event === selectedGw)?.event_transfers}</div>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-2xl col-span-2 sm:col-span-1">
                        <div className="text-zinc-500 text-xs sm:text-sm mb-1">Transfer Value Gain</div>
                        <div className={`text-2xl sm:text-3xl font-mono ${transferValueGain !== null ? (transferValueGain > 0 ? 'text-emerald-400' : transferValueGain < 0 ? 'text-red-400' : 'text-white') : 'text-zinc-600'}`}>
                          {transferValueGain !== null ? (transferValueGain > 0 ? `+${transferValueGain}` : transferValueGain) : '-'}
                        </div>
                      </div>
                    </div>

                    {/* Roast Section */}
                    <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden relative">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-cyan-500"></div>
                      <div className="p-4 sm:p-6 border-b border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0">
                        <div className="flex items-center gap-3">
                          {appMode === 'compliment' ? (
                            <Heart className="w-5 h-5 text-pink-400" />
                          ) : (
                            <Flame className="w-5 h-5 text-emerald-400" />
                          )}
                          <h3 className="text-lg font-semibold">{appMode === 'compliment' ? 'AI Praise' : 'AI Roast'}</h3>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          {roast && (
                            <button
                              onClick={() => setRoastLang(l => l === 'zh' ? 'en' : 'zh')}
                              className="flex-1 sm:flex-none justify-center px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                            >
                              {roastLang === 'zh' ? '🇺🇸 English' : '🇨🇳 中文'}
                            </button>
                          )}
                          <button
                            onClick={handleRoast}
                            disabled={roasting}
                            className={`flex-1 sm:flex-none justify-center px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 ${roast ? 'hidden' : ''}`}
                          >
                            {roasting ? 'Generating...' : (appMode === 'compliment' ? 'Praise My Transfers' : 'Roast My Transfers')}
                          </button>
                        </div>
                      </div>
                      <div className="p-4 sm:p-6 min-h-[150px] flex items-center justify-center">
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

                    {/* Transfers Section */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="p-4 sm:p-6 border-b border-zinc-800 flex items-center gap-3">
                        <ArrowRightLeft className="w-5 h-5 text-zinc-400" />
                        <h3 className="text-lg font-semibold">Transfers Made</h3>
                      </div>
                      <div className="p-4 sm:p-6">
                        {gwTransfers.length > 0 ? (
                          <div className="space-y-4">
                            {gwTransfers.map((t, i) => (
                              <div key={i} className="flex flex-col sm:flex-row items-center justify-between bg-zinc-950 p-3 sm:p-4 rounded-xl border border-zinc-800 gap-3 sm:gap-0">
                                <div className="flex items-center gap-3 text-red-400 w-full sm:w-1/2">
                                  <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                                    <ArrowRightLeft className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium truncate">{getPlayerName(t.element_out)}</div>
                                    <div className="text-xs opacity-70 flex items-center gap-1">
                                      Out <span className="font-mono text-zinc-500">({gwLivePoints[t.element_out] ?? '-'} pts)</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="hidden sm:block w-px h-8 bg-zinc-800 mx-4"></div>
                                <div className="flex items-center gap-3 text-emerald-400 w-full sm:w-1/2 sm:justify-end sm:text-right">
                                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 sm:order-last">
                                    <ArrowRightLeft className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium truncate">{getPlayerName(t.element_in)}</div>
                                    <div className="text-xs opacity-70 flex items-center gap-1 sm:justify-end">
                                      <span className="font-mono text-zinc-500">({gwLivePoints[t.element_in] ?? '-'} pts)</span> In
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-zinc-500">
                            {selectedGw === 1 ? 'Initial squad selection (No transfers in GW1).' : 'No transfers made this gameweek.'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Lineup Section - FPL Style Pitch */}
                    {gwPicks && (
                      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                        <div className="p-4 sm:p-6 border-b border-zinc-800 flex items-center gap-3">
                          <User className="w-5 h-5 text-zinc-400" />
                          <h3 className="text-lg font-semibold">Starting XI & Bench</h3>
                        </div>
                        <div className="p-2 sm:p-6 bg-emerald-900/20 relative overflow-x-auto">
                          {/* Pitch Markings */}
                          <div className="absolute inset-2 sm:inset-4 border-2 border-white/10 rounded-lg pointer-events-none min-w-[300px]"></div>
                          <div className="absolute top-1/2 left-2 sm:left-4 right-2 sm:right-4 h-0.5 bg-white/10 pointer-events-none min-w-[300px]"></div>
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 sm:w-32 sm:h-32 border-2 border-white/10 rounded-full pointer-events-none"></div>

                          <div className="relative z-10 space-y-6 sm:space-y-8 py-4 min-w-[300px]">
                            {/* Starting XI by Rows */}
                            {[1, 2, 3, 4].map(posType => {
                              const playersInRow = gwPicks.picks.filter(p => {
                                const playerInfo = bootstrapData?.elements.find(e => e.id === p.element);
                                return playerInfo?.element_type === posType && p.position <= 11;
                              });

                              return (
                                <div key={posType} className="flex justify-around items-start gap-1 sm:gap-2">
                                  {playersInRow.map(pick => (
                                    <div key={pick.element} className="flex flex-col items-center text-center w-14 sm:w-20">
                                      <div className="relative mb-1">
                                        <div className={`w-10 h-10 sm:w-16 sm:h-16 flex items-center justify-center transition-transform hover:scale-110`}>
                                          <img 
                                            src={getJerseyUrl(pick.element) || ''} 
                                            alt="Jersey"
                                            className="w-full h-full object-contain drop-shadow-xl"
                                            referrerPolicy="no-referrer"
                                          />
                                        </div>
                                        {pick.is_captain && <span className="absolute -top-1 -right-1 text-[9px] sm:text-[10px] bg-emerald-500 text-white px-1 rounded font-bold shadow-sm z-20">C</span>}
                                        {pick.is_vice_captain && <span className="absolute -top-1 -right-1 text-[9px] sm:text-[10px] bg-zinc-700 text-white px-1 rounded font-bold shadow-sm z-20">V</span>}
                                      </div>
                                      <div className="bg-zinc-950/80 backdrop-blur-sm px-1 sm:px-1.5 py-0.5 rounded border border-zinc-800 w-full overflow-hidden shadow-lg">
                                        <div className="text-[9px] sm:text-xs font-medium truncate text-white">{getPlayerName(pick.element)}</div>
                                        <div className="text-[9px] sm:text-[10px] font-mono text-emerald-400">
                                          {gwLivePoints[pick.element] !== undefined 
                                            ? (gwLivePoints[pick.element] * pick.multiplier) 
                                            : '-'} pts
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Bench Section */}
                        <div className="p-4 sm:p-6 bg-zinc-950/50 border-t border-zinc-800 overflow-x-auto">
                          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Substitutes</div>
                          <div className="flex justify-around gap-2 min-w-[300px]">
                            {gwPicks.picks.filter(p => p.position > 11).sort((a, b) => a.position - b.position).map(pick => (
                              <div key={pick.element} className="flex flex-col items-center text-center w-14 sm:w-20 opacity-80">
                                <div className="w-8 h-8 sm:w-12 sm:h-12 flex items-center justify-center mb-1">
                                  <img 
                                    src={getJerseyUrl(pick.element) || ''} 
                                    alt="Jersey"
                                    className="w-full h-full object-contain drop-shadow-md"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                                <div className="text-[9px] sm:text-xs font-medium truncate text-zinc-300 w-full">{getPlayerName(pick.element)}</div>
                                <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500">{gwLivePoints[pick.element] ?? '-'} pts</div>
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
