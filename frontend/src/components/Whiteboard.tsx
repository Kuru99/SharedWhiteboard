import React, { useRef, useEffect, useState } from 'react';

interface Point {
  x: number;
  y: number;
}

interface LineElement {
  id: string;
  type: 'line';
  points: Point[];
  color: string;
  width: number;
}

interface TextElement {
  id: string;
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

type BoardElement = LineElement | TextElement;

type Tool = 'pencil' | 'eraser' | 'text';

const colors = ['#000000', '#eb4d4b', '#6ab04c', '#22a6b3', '#be2edd', '#f0932b'];

interface WhiteboardProps {
  boardId: string;
}

const Whiteboard: React.FC<WhiteboardProps> = ({ boardId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // このクライアントを一意に識別するID（エコーバック防止用）
  const clientIdRef = useRef<string>(`${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const connectionIdRef = useRef<string>(`${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  // ホワイトボードの状態
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#000000');
  const [width, setWidth] = useState(3);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // 描画・パン用の内部状態
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const currentLineId = useRef<string | null>(null);
  const lastPos = useRef<Point>({ x: 0, y: 0 });
  const touchStartPan = useRef({ x: 0, y: 0 });
  const touchStartMidpoint = useRef<Point>({ x: 0, y: 0 });
  const panStartPointer = useRef<Point>({ x: 0, y: 0 });

  // RAF描画用Ref（Reactのレンダーサイクルを介さずキャンバスを直接更新）
  const elementsRef = useRef<BoardElement[]>([]);
  const currentStrokeRef = useRef<LineElement | null>(null);
  const currentStrokePointsRef = useRef<Point[]>([]);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  // テキスト入力オーバーレイ用の状態
  const inputRef = useRef<HTMLInputElement>(null);
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    worldX: number;
    worldY: number;
  } | null>(null);
  const [textValue, setTextValue] = useState('');

  // テキスト入力表示時、確実にフォーカスを当てる
  useEffect(() => {
    if (textInput && inputRef.current) {
      // 少し遅延を入れてレンダリング完了後にフォーカスさせる
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [textInput]);

  // パレット（ツールバー）制御: 表示 / 位置 / サイズ
  const [paletteVisible, setPaletteVisible] = useState(true);
  const [paletteScale, setPaletteScale] = useState(1);
  const palettePosRef = useRef<{ top: number; left: number | null }>({ top: 20, left: null });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; startLeft: number | null; startTop: number; pointerId?: number } | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const capturedElementRef = useRef<Element | null>(null);

  const startPaletteDrag = (e: React.PointerEvent) => {
    const clientX = e.clientX;
    const clientY = e.clientY;
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: clientX,
      y: clientY,
      startLeft: palettePosRef.current.left,
      startTop: palettePosRef.current.top,
      pointerId: e.pointerId,
    };
    // create drag preview element so we only commit position on pointerup
    try {
      if (!previewRef.current) {
        const preview = document.createElement('div');
        preview.className = 'palette-preview';
        preview.style.position = 'absolute';
        preview.style.pointerEvents = 'none';
        preview.style.opacity = '0.9';
        preview.style.zIndex = '2499';
        // initial placement
        const left = (palettePosRef.current.left === null) ? (window.innerWidth / 2) : (palettePosRef.current.left as number);
        preview.style.left = `${left}px`;
        preview.style.top = `${palettePosRef.current.top}px`;
        preview.style.transform = `translate(0,0) scale(${paletteScale})`;
        document.body.appendChild(preview);
        previewRef.current = preview;
      }
    } catch (err) {
      // ignore
    }
    try {
      const el = e.currentTarget as Element | null;
      if (el && (el as any).setPointerCapture) {
        (el as any).setPointerCapture(e.pointerId);
        capturedElementRef.current = el;
      } else if ((e.target as Element) && (e.target as Element).setPointerCapture) {
        (e.target as Element).setPointerCapture(e.pointerId);
        capturedElementRef.current = e.target as Element;
      }
    } catch (err) {
      // ignore
    }
  };

  // Decide whether dragging should start when pointerdown occurs on toolbar.
  const shouldStartDrag = (e: React.PointerEvent) => {
    // Only start drag for primary button (left click) or touch/pen interactions
    if (!(e.button === 0 || e.pointerType === 'touch' || e.pointerType === 'pen')) return false;

    // If target is an interactive control, don't start drag
    let el: Element | null = e.target as Element | null;
    while (el && el !== document.body) {
      const tag = el.tagName && el.tagName.toUpperCase();
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A') return false;
      const cls = el.classList || [];
      if (cls.contains('tool-btn') || cls.contains('color-btn') || cls.contains('action-btn') || cls.contains('clear-btn') || cls.contains('width-slider')) return false;
      // stop if we've reached the toolbar container
      if (cls.contains('toolbar')) break;
      el = el.parentElement;
    }
    return true;
  };

  const onPalettePointerMove = (e: PointerEvent) => {
    if (!isDraggingRef.current || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const newLeft = (dragStartRef.current.startLeft ?? window.innerWidth / 2) + dx;
    const newTop = Math.max(0, dragStartRef.current.startTop + dy);
    // move preview only; commit on pointerup
    try {
      if (previewRef.current) {
        previewRef.current.style.left = `${newLeft}px`;
        previewRef.current.style.top = `${newTop}px`;
      }
    } catch (err) {
      // ignore
    }
  };

  const endPaletteDrag = (e?: PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    // compute final position (use preview position if available)
    let finalLeft: number | null = palettePosRef.current.left;
    let finalTop: number = palettePosRef.current.top;
    try {
      if (previewRef.current) {
        const pl = parseFloat(previewRef.current.style.left || '0');
        const pt = parseFloat(previewRef.current.style.top || '0');
        finalLeft = isNaN(pl) ? finalLeft : pl;
        finalTop = isNaN(pt) ? finalTop : pt;
      } else if (e && dragStartRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        finalLeft = (dragStartRef.current.startLeft ?? window.innerWidth / 2) + dx;
        finalTop = Math.max(0, dragStartRef.current.startTop + dy);
      }
    } catch (err) {
      // ignore
    }

    // commit position
    palettePosRef.current = { top: finalTop, left: finalLeft };
    // remove preview
    try {
      if (previewRef.current && previewRef.current.parentElement) {
        previewRef.current.parentElement.removeChild(previewRef.current);
      }
    } catch (err) {
      // ignore
    }
    previewRef.current = null;

    // release pointer capture if we captured it
    try {
      const el = capturedElementRef.current;
      const pid = dragStartRef.current?.pointerId;
      if (el && pid !== undefined && (el as any).releasePointerCapture) {
        try { (el as any).releasePointerCapture(pid); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // ignore
    }
    capturedElementRef.current = null;
    dragStartRef.current = null;

    // force update and persist
    setPaletteScale((s) => s);
    savePaletteSettings();
  };

  useEffect(() => {
    window.addEventListener('pointermove', onPalettePointerMove);
    window.addEventListener('pointerup', endPaletteDrag);
    window.addEventListener('pointercancel', endPaletteDrag);
    return () => {
      window.removeEventListener('pointermove', onPalettePointerMove);
      window.removeEventListener('pointerup', endPaletteDrag);
      window.removeEventListener('pointercancel', endPaletteDrag);
    };
  }, []);

  // persist palette settings
  const PALETTE_KEY = 'sharedwhiteboard_palette_v1';
  const savePaletteSettings = () => {
    try {
      const data = {
        visible: paletteVisible,
        scale: paletteScale,
        pos: palettePosRef.current,
      } as any;
      localStorage.setItem(PALETTE_KEY, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PALETTE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d.visible === 'boolean') setPaletteVisible(d.visible);
        if (typeof d.scale === 'number') setPaletteScale(d.scale);
        if (d.pos && typeof d.pos.top === 'number') palettePosRef.current = { top: d.pos.top, left: d.pos.left ?? null };
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // save on changes
  useEffect(() => savePaletteSettings(), [paletteVisible, paletteScale]);

  const resetPaletteToDefault = () => {
    try {
      localStorage.removeItem(PALETTE_KEY);
    } catch (e) {}
    palettePosRef.current = { top: 20, left: null };
    setPaletteScale(1);
    setPaletteVisible(true);
    // small state update to force style recalculation
    setPaletteScale((s) => s);
  };

  const getApiHost = () => {
    const envHost = import.meta.env.VITE_API_BASE_URL;
    if (envHost && envHost !== '') {
      return envHost;
    }
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:8000`;
  };

  const getWebSocketHost = () => {
    const envHost = import.meta.env.VITE_WS_BASE_URL;
    if (envHost && envHost !== '') {
      return envHost;
    }
    return getApiHost().replace(/^http/, 'ws');
  };

  // 1. WebSocketとCanvasリサイズの設定
  useEffect(() => {
    // ボード切り替え時は前のボード内容をクリア
    setElements([]);
    elementsRef.current = [];
    currentStrokeRef.current = null;
    currentStrokePointsRef.current = [];

    const wsHost = getWebSocketHost();
    connectionIdRef.current = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const socket = new WebSocket(`${wsHost}/ws?boardId=${boardId}`);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // 同じ接続からの即時エコーだけ無視し、再接続時の履歴は受け取る
        if (data.clientId === clientIdRef.current && data.connectionId === connectionIdRef.current) return;

        if (data.type === 'draw_step') {
          handleIncomingDrawStep(data);
        } else if (data.type === 'text') {
          handleIncomingText(data);
        } else if (data.type === 'undo') {
          handleIncomingUndo(data.id);
        } else if (data.type === 'clear') {
          setElements([]);
        }
      } catch (e) {
        console.error("Error parsing WS message:", e);
      }
    };

    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const parent = canvas.parentElement;
        if (parent) {
          canvas.width = parent.clientWidth;
          canvas.height = parent.clientHeight;
        }
      }
    };

    // グローバルキーボードショートカット
    const handleKeyDown = (e: KeyboardEvent) => {
      // 入力フィールドフォーカス中はショートカットを無視
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.key === 'Escape') {
        setTool('pencil');
      } else if (e.key.toLowerCase() === 'p') {
        setTool('pencil');
      } else if (e.key.toLowerCase() === 'e') {
        setTool('eraser');
      } else if (e.key.toLowerCase() === 't') {
        setTool('text');
      } else if (e.key === '[') {
        setWidth((w) => Math.max(2, w - 1));
      } else if (e.key === ']') {
        setWidth((w) => Math.min(15, w + 1));
      } else if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        const index = parseInt(e.key) - 1;
        if (index < colors.length) {
          setColor(colors[index]);
        }
      }
    };

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', handleKeyDown);
    resizeCanvas();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('keydown', handleKeyDown);
      socket.close();
    };
  }, [boardId]);

  // 2a. Refをstateと同期（RAFループから参照するため）
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);

  // 2b. RAFレンダーループ（Reactのレンダーサイクルと独立して60fps描画）
  useEffect(() => {
    const drawElement = (ctx: CanvasRenderingContext2D, el: BoardElement) => {
      if (el.type === 'line') {
        const line = el as LineElement;
        if (line.points.length < 1) return;
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        for (let i = 1; i < line.points.length; i++) {
          ctx.lineTo(line.points[i].x, line.points[i].y);
        }
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.closePath();
      } else if (el.type === 'text') {
        const txt = el as TextElement;
        ctx.fillStyle = txt.color;
        ctx.font = `${txt.fontSize}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(txt.text, txt.x, txt.y);
      }
    };

    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          ctx.translate(panOffsetRef.current.x, panOffsetRef.current.y);
          // コミット済み要素を描画
          elementsRef.current.forEach((el) => drawElement(ctx, el));
          // 描画中のストローク（stateに未コミット）を最前面に描画
          if (currentStrokeRef.current) {
            drawElement(ctx, currentStrokeRef.current);
          }
          ctx.restore();
        }
      }
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []); // マウント時に一度だけ起動

  // 3. WS受信ハンドラー
  // 座標はワールド座標（絶対値）で受信 → そのまま使用
  const handleIncomingDrawStep = (data: any) => {
    const { id, x0, y0, x1, y1, color: strokeColor, width: strokeWidth } = data;
    setElements((prev) => {
      const index = prev.findIndex((el) => el.id === id);
      if (index !== -1) {
        const updated = { ...prev[index] } as LineElement;
        updated.points = [...updated.points, { x: x1, y: y1 }];
        const next = [...prev];
        next[index] = updated;
        return next;
      } else {
        return [
          ...prev,
          {
            id,
            type: 'line',
            points: [
              { x: x0, y: y0 },
              { x: x1, y: y1 },
            ],
            color: strokeColor,
            width: strokeWidth,
          },
        ];
      }
    });
  };

  const handleIncomingText = (data: any) => {
    const { id, x, y, text, color: textColor, fontSize } = data;
    setElements((prev) => [
      ...prev,
      { id, type: 'text', x, y, text, color: textColor, fontSize },
    ]);
  };

  const handleIncomingUndo = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
  };

  // 4. マウス・タッチ操作ハンドラー
  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    // テキスト入力中は他操作を受け付けない
    if (textInput) return;

    const isTouch = 'touches' in e;

    if (isTouch) {
      const touchEvent = e as React.TouchEvent;
      if (touchEvent.touches.length === 2) {
        // 2本指：画面移動（パン）の開始
        setIsPanning(true);
        setIsDrawing(false);
        const mid = getTouchMidpoint(touchEvent);
        touchStartMidpoint.current = mid;
        touchStartPan.current = { ...panOffset };
        return;
      }
    } else {
      const mouseEvent = e as React.MouseEvent;
      if (mouseEvent.button === 1 || mouseEvent.button === 2 || mouseEvent.altKey) {
        // 中クリック / 右クリック / Alt+ドラッグ でパン
        e.preventDefault();
        setIsPanning(true);
        setIsDrawing(false);
        panStartPointer.current = getClientCoordinates(e);
        touchStartPan.current = { ...panOffset };
        return;
      }
    }

    // 1本指またはマウス：描画のみ（テキスト配置はonClickで処理）
    if (tool !== 'text') {
      setIsDrawing(true);
      const worldPos = getWorldCoordinates(e);
      lastPos.current = worldPos;
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      currentLineId.current = id;

      // 描画中ストロークをRefで初期化（setElements不要）
      const strokeColor = tool === 'eraser' ? '#ffffff' : color;
      const strokeWidth = tool === 'eraser' ? width * 4 : width;
      currentStrokePointsRef.current = [worldPos];
      currentStrokeRef.current = {
        id,
        type: 'line',
        points: [worldPos],
        color: strokeColor,
        width: strokeWidth,
      };
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (tool !== 'text') return;
    if (textInput) return; // すでに配置中の場合は何もしない

    const pos = getClientCoordinates(e);
    const worldPos = getWorldCoordinates(e);
    setTextInput({
      x: pos.x,
      y: pos.y,
      worldX: worldPos.x,
      worldY: worldPos.y,
    });
    setTextValue('');
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const isTouch = 'touches' in e;

    if (isTouch && isPanning) {
      // 2本指の画面移動処理
      const touchEvent = e as React.TouchEvent;
      if (touchEvent.touches.length === 2) {
        const mid = getTouchMidpoint(touchEvent);
        const dx = mid.x - touchStartMidpoint.current.x;
        const dy = mid.y - touchStartMidpoint.current.y;
        setPanOffset({
          x: touchStartPan.current.x + dx,
          y: touchStartPan.current.y + dy,
        });
      }
      return;
    }

    if (!isTouch && isPanning) {
      if ((e as React.MouseEvent).buttons === 0) {
        setIsPanning(false);
        return;
      }
      const current = getClientCoordinates(e);
      const dx = current.x - panStartPointer.current.x;
      const dy = current.y - panStartPointer.current.y;
      setPanOffset({
        x: touchStartPan.current.x + dx,
        y: touchStartPan.current.y + dy,
      });
      return;
    }

    if (!isDrawing) return;

    const worldPos = getWorldCoordinates(e);
    const lineId = currentLineId.current;

    if (lineId) {
      const strokeColor = tool === 'eraser' ? '#ffffff' : color;
      const strokeWidth = tool === 'eraser' ? width * 4 : width;

      // setElements()を呼ばず、Refだけ更新 → RAFループが次フレームで描画
      const newPoints = [...currentStrokePointsRef.current, worldPos];
      currentStrokePointsRef.current = newPoints;
      currentStrokeRef.current = {
        id: lineId,
        type: 'line',
        points: newPoints,
        color: strokeColor,
        width: strokeWidth,
      };

      // WebSocketで送信（ワールド座標をそのまま送信）
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'draw_step',
            clientId: clientIdRef.current,
            connectionId: connectionIdRef.current,
            id: lineId,
            x0: lastPos.current.x,
            y0: lastPos.current.y,
            x1: worldPos.x,
            y1: worldPos.y,
            color: strokeColor,
            width: strokeWidth,
          })
        );
      }
    }

    lastPos.current = worldPos;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    setPanOffset((prev) => ({
      x: prev.x - e.deltaX,
      y: prev.y - e.deltaY,
    }));
  };

  const handleMouseUp = () => {
    // 描画中ストロークをstateにコミット（ここで初めてsetElementsを呼ぶ）
    if (currentStrokeRef.current) {
      const stroke = currentStrokeRef.current;
      setElements((prev) => [...prev, stroke]);
      currentStrokeRef.current = null;
      currentStrokePointsRef.current = [];
    }
    setIsDrawing(false);
    setIsPanning(false);
    currentLineId.current = null;
  };

  // 5. 座標計算ヘルパー
  const getClientCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX, clientY;
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const getWorldCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const clientPos = getClientCoordinates(e);
    return {
      x: clientPos.x - panOffset.x,
      y: clientPos.y - panOffset.y,
    };
  };

  const getTouchMidpoint = (e: React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas || e.touches.length < 2) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    return {
      x: (t1.clientX + t2.clientX) / 2 - rect.left,
      y: (t1.clientY + t2.clientY) / 2 - rect.top,
    };
  };

  // 6. テキスト送信処理
  const submitText = () => {
    if (!textInput) return;

    if (textValue.trim() !== '') {
      const textId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const fontSize = width * 5; // 太さスライダーを文字サイズに流用

      const newText: TextElement = {
        id: textId,
        type: 'text',
        x: textInput.worldX,
        y: textInput.worldY,
        text: textValue,
        color: color,
        fontSize: fontSize,
      };

      setElements((prev) => [...prev, newText]);

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'text',
            clientId: clientIdRef.current,
            connectionId: connectionIdRef.current,
            id: textId,
            x: textInput.worldX,
            y: textInput.worldY,
            text: textValue,
            color: color,
            fontSize: fontSize,
          })
        );
      }
    }

    setTextInput(null);
    setTextValue('');
  };

  // 7. アクションツールバー処理
  const handleUndo = () => {
    // elementsRef.current で常に最新の状態を参照（staleクロージャを回避）
    const currentElements = elementsRef.current;
    if (currentElements.length === 0) return;
    const lastElement = currentElements[currentElements.length - 1];

    setElements((prev) => prev.slice(0, -1));

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'undo',
          clientId: clientIdRef.current,
          connectionId: connectionIdRef.current,
          id: lastElement.id,
        })
      );
    }
  };

  const handleClear = () => {
    if (window.confirm("本当にキャンバス全体を消去しますか？")) {
      setElements([]);
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'clear',
            clientId: clientIdRef.current,
            connectionId: connectionIdRef.current,
          })
        );
      }
    }
  };

  const saveBoardToLocalStorage = (boardElements: BoardElement[]) => {
    try {
      const boardData = {
        boardId,
        timestamp: new Date().toISOString(),
        elements: boardElements,
      };
      localStorage.setItem(`board-${boardId}`, JSON.stringify(boardData));
    } catch (error) {
      console.error('Auto-save error:', error);
    }
  };

  const loadBoardFromLocalStorage = () => {
    try {
      const raw = localStorage.getItem(`board-${boardId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { elements?: BoardElement[] };
      if (parsed?.elements && Array.isArray(parsed.elements)) {
        setElements(parsed.elements);
        elementsRef.current = parsed.elements;
      }
    } catch (error) {
      console.error('Load board data error:', error);
    }
  };

  useEffect(() => {
    loadBoardFromLocalStorage();
  }, [boardId]);

  useEffect(() => {
    saveBoardToLocalStorage(elements);
  }, [boardId, elements]);

  return (
    <div className="whiteboard-wrapper">
      {/* ツールバー */}
      {/* トグルボタン（パレットの表示/非表示） */}
      <div className="palette-controls">
        <button
          className="palette-toggle"
          onClick={() => { setPaletteVisible((v) => !v); savePaletteSettings(); }}
          title={paletteVisible ? 'ツールを非表示' : 'ツールを表示'}
        >
          {paletteVisible ? 'Hide' : 'Show'}
        </button>
        <button
          className="palette-reset"
          onClick={resetPaletteToDefault}
          title="パレットをリセット"
        >
          Reset
        </button>
      </div>

      <div
        className="toolbar"
        style={(() => {
          const pos = palettePosRef.current;
          const style: React.CSSProperties = {};
          if (!paletteVisible) {
            style.display = 'none';
          }
          // ensure values include px units when numeric
          if (pos.left === null) {
            style.left = '50%';
            style.transform = `translateX(-50%) scale(${paletteScale})`;
            style.top = typeof pos.top === 'number' ? `${pos.top}px` : (pos.top as any);
          } else {
            style.left = typeof pos.left === 'number' ? `${pos.left}px` : (pos.left as any);
            style.top = typeof pos.top === 'number' ? `${pos.top}px` : (pos.top as any);
            style.transform = `translate(0,0) scale(${paletteScale})`;
          }
          // make toolbar appear above header/other UI
          style.zIndex = 2000;
          return style;
        })()}
        onPointerDown={(e) => { if (shouldStartDrag(e)) startPaletteDrag(e); }}
      >
        {/* ボタンのない領域をドラッグすると移動します（ハンドル不要） */}
        {/* モード選択 */}
        <div className="tool-group">
          <button
            className={`tool-btn ${tool === 'pencil' ? 'active' : ''}`}
            onClick={() => setTool('pencil')}
            title="ペン"
          >
            ✏️
          </button>
          <button
            className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title="消しゴム"
          >
            🧽
          </button>
          <button
            className={`tool-btn ${tool === 'text' ? 'active' : ''}`}
            onClick={() => setTool('text')}
            title="テキスト入力"
          >
            🔤
          </button>
        </div>

        <div className="divider" />

        {/* サイズ操作 */}
        <div className="tool-group">
          <button className="tool-btn scale-btn" onClick={() => setPaletteScale((s) => Math.max(0.6, s - 0.1))} title="小さく" aria-label="縮小">
            −
          </button>
          <span style={{ fontSize: '0.85rem', color: '#475569' }}>{Math.round(paletteScale * 100)}%</span>
          <button className="tool-btn scale-btn" onClick={() => setPaletteScale((s) => Math.min(1.6, s + 0.1))} title="大きく" aria-label="拡大">
            ＋
          </button>
        </div>

        <div className="divider" />

        {/* 色選択 (消しゴムモード以外で表示) */}
        {tool !== 'eraser' && (
          <div className="tool-group">
            {colors.map((c) => (
              <button
                key={c}
                className={`color-btn ${color === c ? 'active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        )}

        <div className="divider" />

        {/* ペンの太さ / フォントサイズ */}
        <div className="tool-group">
          <input
            type="range"
            min="2"
            max="15"
            value={width}
            onChange={(e) => setWidth(parseInt(e.target.value))}
            className="width-slider"
          />
          <span className="width-label">{tool === 'text' ? `${width * 5}px` : `${width}px`}</span>
        </div>

        <div className="divider" />

        {/* 特殊操作 */}
        <div className="tool-group">
          <button className="action-btn" onClick={handleUndo} title="元に戻す">
            ↩️ 元に戻す
          </button>
          <button className="action-btn" onClick={() => setPanOffset({ x: 0, y: 0 })} title="位置リセット">
            🎯 位置リセット
          </button>
          <button className="clear-btn" onClick={handleClear} title="全消去">
            🗑️ 全消去
          </button>
        </div>
      </div>

      {/* キャンバス */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseOut={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleWheel}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        onClick={handleCanvasClick}
        className="whiteboard-canvas"
      />

      {/* テキスト入力用オーバーレイ */}
      {textInput && (
        <div
          className="text-input-overlay"
          style={{
            left: `${textInput.x}px`,
            top: `${textInput.y}px`,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitText();
              if (e.key === 'Escape') setTextInput(null);
            }}
            onBlur={submitText}
            autoFocus
            style={{
              color: color,
              fontSize: `${width * 5}px`,
            }}
          />
        </div>
      )}

      <style>{`
        .whiteboard-wrapper {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .whiteboard-canvas {
          cursor: ${tool === 'text' ? 'text' : isPanning ? 'grabbing' : 'crosshair'};
          touch-action: none;
        }
        .toolbar {
          position: absolute;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 1rem;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(8px);
          padding: 0.6rem 1.2rem;
          border-radius: 50px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
          z-index: 2000;
          flex-wrap: wrap;
          justify-content: center;
          max-width: 90%;
        }
        .tool-group {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .tool-btn {
          background: transparent;
          border: none;
          font-size: 1.2rem;
          padding: 0.4rem;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
        }
        .tool-btn:hover {
          background: #f1f5f9;
        }
        .tool-btn.active {
          background: #e2e8f0;
          transform: scale(1.05);
        }
        .color-btn {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .color-btn:hover {
          transform: scale(1.2);
        }
        .color-btn.active {
          border-color: #475569;
          transform: scale(1.1);
        }
        .divider {
          width: 1px;
          height: 20px;
          background: #cbd5e1;
        }
        .width-slider {
          width: 70px;
          cursor: pointer;
        }
        .width-label {
          font-size: 0.75rem;
          color: #64748b;
          min-width: 30px;
          text-align: center;
        }
        .action-btn {
          background: #f1f5f9;
          color: #334155;
          border: 1px solid #e2e8f0;
          padding: 0.35rem 0.75rem;
          border-radius: 20px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: background 0.2s;
        }
        .action-btn:hover {
          background: #e2e8f0;
        }
        .action-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .clear-btn {
          background: #ef4444;
          color: white;
          border: none;
          padding: 0.35rem 0.75rem;
          border-radius: 20px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: background 0.2s;
        }
        .clear-btn:hover {
          background: #dc2626;
        }
        .text-input-overlay {
          position: absolute;
          z-index: 50;
          transform: translateY(-50%);
        }
        .text-input-overlay input {
          background: transparent;
          border: 1px dashed #94a3b8;
          outline: none;
          padding: 2px 4px;
          font-family: sans-serif;
        }
        .palette-toggle {
          position: absolute;
          right: 16px;
          top: 16px;
          z-index: 2100;
          background: rgba(255,255,255,0.9);
          border: 1px solid #e2e8f0;
          padding: 6px 10px;
          border-radius: 8px;
          cursor: pointer;
        }
        .palette-controls { position: absolute; right: 16px; top: 12px; z-index:2100; display:flex; gap:8px; }
        .palette-reset { background:#ef4444; color:white; border:none; padding:6px 8px; border-radius:8px; cursor:pointer }
        .palette-reset:hover { background:#dc2626 }
        .palette-preview {
          width: auto;
          height: auto;
          background: rgba(255,255,255,0.95);
          border-radius: 12px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.12);
          transition: transform 0.08s linear;
          padding: 8px;
          display: inline-block;
        }
        /* タッチ向けにボタンを大きめに */
        .tool-btn, .action-btn, .clear-btn, .color-btn {
          touch-action: manipulation;
          min-width: 36px;
          min-height: 36px;
          padding: 8px;
        }
        .scale-btn {
          background: #2563eb;
          color: #fff;
          border: none;
          padding: 6px 10px;
          border-radius: 8px;
          font-weight: 600;
          box-shadow: 0 2px 6px rgba(37,99,235,0.18);
        }
        .scale-btn:hover {
          background: #1e40af;
        }
      `}</style>
    </div>
  );
};

export default Whiteboard;
