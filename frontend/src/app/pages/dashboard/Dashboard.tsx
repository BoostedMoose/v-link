import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback } from 'react';
import React from 'react';
import { APP, useThemeColor } from '@/store/Store';
import styled, { useTheme } from 'styled-components';
import { Oval } from 'react-loader-spinner';

import { Fade } from '@/theme/styles/Effects';
import Pagination from '@/app/components/Pagination';

// Lazy load components
const Classic = lazy(() => import('./classic/Classic'));
const Race = lazy(() => import('./race/Race'));
const Charts = lazy(() => import('./charts/Charts'));

const DashBoard = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  overflow: hidden;
`;

const Wrapper = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
`;

interface PageWrapperProps {
  translateX: string;
  opacity: number;
  isTransitioning: boolean;
  isDragging: boolean;
}

const PageWrapper = styled.div.attrs<PageWrapperProps>(props => ({
  style: {
    transform: `translate3d(${props.translateX}, 0, 0)`,
    opacity: props.opacity,
    transition: props.isTransitioning
      ? 'transform 0.4s ease-out, opacity 0.4s ease-out'
      : props.isDragging
        ? 'none'
        : 'transform 0.3s ease-out, opacity 0.3s ease-out'
  }
}))<PageWrapperProps>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  will-change: transform, opacity;
`;

const LoadingWrapper = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
`;

const DRAG_THRESHOLD = 30;
const TRANSITION_DURATION = 400;
const MIN_DRAG_DISTANCE = 10;

function Dashboard() {
  const theme = useTheme();
  const dashBoardRef = useRef<HTMLDivElement | null>(null);
  const resizeDebounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  
  // Refs for drag state to avoid unnecessary re-renders
  const dragStateRef = useRef({
    startX: 0,
    currentX: 0,
    offset: 0,
    isDragging: false,
    isPointerDown: false
  });
  
  const animationFrameRef = useRef<number | null>(null);
  const containerWidthRef = useRef(window.innerWidth);

  type GeneralSettings = { defaultDash: { value: string }; colorTheme: { value: string } };
  type AppBindings = { left: { value: string }; right: { value: string } };
  const defaultDash = APP((state) => (state.settings.general as GeneralSettings | undefined)?.defaultDash?.value ?? 'Classic');
  const colorTheme = useThemeColor();
  const app_bindings = APP((state) => state.settings.app_bindings as AppBindings | undefined);
  const appUpdate = APP((state) => state.update);
  const keyStroke = APP((state) => state.keyStroke);

  const components = useMemo(() => [
    { name: "Classic", component: Classic },
    { name: "Race", component: Race },
    { name: "Charts", component: Charts },
  ], []);

  const defaultComponentIndex = useMemo(() => 
    components.findIndex(
      (item) => item.name === defaultDash
    ), [components, defaultDash]
  );

  // Reduced state - only what needs to trigger re-renders
  const [currentPageIndex, setCurrentPageIndex] = useState(defaultComponentIndex);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionState, setTransitionState] = useState<{ oldIndex: number | null; newIndex: number | null; direction: string | null }>({
    oldIndex: null,
    newIndex: null,
    direction: null
  });
  
  // Single state for drag rendering updates
  const [dragRenderOffset, setDragRenderOffset] = useState(0);
  const [isDragRendering, setIsDragRendering] = useState(false);

  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Utility functions
  const getAdjacentIndices = useCallback((index: number) => {
    const prevIndex = index === 0 ? components.length - 1 : index - 1;
    const nextIndex = index === components.length - 1 ? 0 : index + 1;
    return { prevIndex, nextIndex };
  }, [components.length]);

  // Optimized drag percentage calculation using ref
  const calculateDragPercentage = useCallback((dragDistance: number) => {
    return Math.max(-100, Math.min(100, (dragDistance / containerWidthRef.current) * 100));
  }, []);

  // Throttled render update function
  const updateDragRender = useCallback(() => {
    const dragState = dragStateRef.current;
    const dragDistance = dragState.currentX - dragState.startX;
    const dragPercentage = calculateDragPercentage(dragDistance);
    
    setDragRenderOffset(dragPercentage);
    
    // Only set isDragRendering if we're actually dragging significantly
    const shouldRender = Math.abs(dragPercentage) > 2; // Small threshold to avoid micro-movements
    if (shouldRender !== isDragRendering) {
      setIsDragRendering(shouldRender);
    }
  }, [calculateDragPercentage, isDragRendering]);

  // Window resize handler with container width caching
  useEffect(() => {
    const handleResize = () => {
      if (resizeDebounceTimeout.current) {
        clearTimeout(resizeDebounceTimeout.current);
      }
      resizeDebounceTimeout.current = setTimeout(() => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;
        
        setWindowSize({
          width: newWidth,
          height: newHeight,
        });
        
        // Update cached container width
        if (dashBoardRef.current) {
          containerWidthRef.current = dashBoardRef.current.offsetWidth || newWidth;
        } else {
          containerWidthRef.current = newWidth;
        }
      }, 100);
    };

    window.addEventListener('resize', handleResize);
    
    // Initial container width setup
    if (dashBoardRef.current) {
      containerWidthRef.current = dashBoardRef.current.offsetWidth || window.innerWidth;
    }
    
    return () => {
      if (resizeDebounceTimeout.current) clearTimeout(resizeDebounceTimeout.current);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Update content size (throttled)
  useEffect(() => {
    if (dashBoardRef.current) {
      const rect = dashBoardRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        containerWidthRef.current = rect.width;
        
        appUpdate((state) => {
          if (state.system.interface) {
            state.system.contentSize.width = rect.width;
            state.system.contentSize.height = rect.height;
          }
        });
      }
    }
  }, [windowSize, appUpdate]);

  // Transition logic
  const performTransition = useCallback((direction: string) => {
    if (isTransitioning) return;

    const newIndex = direction === 'left' 
      ? (currentPageIndex === components.length - 1 ? 0 : currentPageIndex + 1)
      : (currentPageIndex === 0 ? components.length - 1 : currentPageIndex - 1);

    setIsTransitioning(true);
    setDragRenderOffset(0);
    setIsDragRendering(false);
    
    // Reset drag state
    dragStateRef.current = {
      startX: 0,
      currentX: 0,
      offset: 0,
      isDragging: false,
      isPointerDown: false
    };
    
    setTransitionState({
      oldIndex: currentPageIndex,
      newIndex: newIndex,
      direction: direction
    });

    setTimeout(() => {
      setCurrentPageIndex(newIndex);
      setIsTransitioning(false);
      setTransitionState({
        oldIndex: null,
        newIndex: null,
        direction: null
      });
    }, TRANSITION_DURATION);
  }, [isTransitioning, currentPageIndex, components.length]);

  const swipeLeft = useCallback(() => performTransition('left'), [performTransition]);
  const swipeRight = useCallback(() => performTransition('right'), [performTransition]);

  // Optimized pointer handlers using refs
  const handlePointerStart = useCallback((position: number) => {
    if (isTransitioning) return;
    
    dragStateRef.current = {
      startX: position,
      currentX: position,
      offset: 0,
      isDragging: false,
      isPointerDown: true
    };
  }, [isTransitioning]);

  // Optimized pointer move with RAF throttling
  const updateDragRenderRef = useRef(updateDragRender);
  updateDragRenderRef.current = updateDragRender;

  const handlePointerMove = useCallback((position: number) => {
    const dragState = dragStateRef.current;
    
    if (isTransitioning || !dragState.isPointerDown) return;
    
    // Cancel previous animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    // Update current position immediately
    dragState.currentX = position;
    
    // Check if we should start dragging
    const dragDistance = position - dragState.startX;
    if (!dragState.isDragging && Math.abs(dragDistance) > MIN_DRAG_DISTANCE) {
      dragState.isDragging = true;
    }
    
    // Only update render if we're dragging
    if (dragState.isDragging) {
      animationFrameRef.current = requestAnimationFrame(() => {
        updateDragRenderRef.current();
      });
    }
  }, [isTransitioning,]);

  const handlePointerEnd = useCallback(() => {
    const dragState = dragStateRef.current;
    
    if (isTransitioning || !dragState.isPointerDown) return;
    
    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    const dragDistance = dragState.currentX - dragState.startX;
    const dragPercentage = calculateDragPercentage(dragDistance);
    
    if (Math.abs(dragPercentage) > DRAG_THRESHOLD) {
      if (dragPercentage > 0) {
        swipeRight();
      } else {
        swipeLeft();
      }
    } else {
      // Reset to original position
      setDragRenderOffset(0);
      setIsDragRendering(false);
    }

    // Reset drag state
    dragStateRef.current = {
      startX: 0,
      currentX: 0,
      offset: 0,
      isDragging: false,
      isPointerDown: false
    };
  }, [isTransitioning, calculateDragPercentage, swipeRight, swipeLeft]);

  // Event handlers
  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    const clickX = event.clientX;
    const halfWindowWidth = window.innerWidth / 2;
    clickX < halfWindowWidth ? swipeRight() : swipeLeft();
  }, [swipeRight, swipeLeft]);

  // Global pointer up listener
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (dragStateRef.current.isPointerDown) {
        handlePointerEnd();
      }
    };

    document.addEventListener('mouseup', handleGlobalPointerUp);
    document.addEventListener('touchend', handleGlobalPointerUp);
    
    return () => {
      document.removeEventListener('mouseup', handleGlobalPointerUp);
      document.removeEventListener('touchend', handleGlobalPointerUp);
      // Clean up animation frame on unmount
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [handlePointerEnd]);

  // Keyboard navigation
  useEffect(() => {
    if (keyStroke === app_bindings?.left?.value) swipeRight();
    if (keyStroke === app_bindings?.right?.value) swipeLeft();
  }, [keyStroke, app_bindings, swipeRight, swipeLeft]);

  // Get transform and opacity for each component (memoized with fewer dependencies)
  const getComponentTransform = useCallback((index: number) => {
    const { prevIndex, nextIndex } = getAdjacentIndices(currentPageIndex);

    if (isDragRendering) {
      if (index === currentPageIndex) {
        return { 
          translateX: `${dragRenderOffset}%`, 
          opacity: 1 - Math.abs(dragRenderOffset) * 0.003 
        };
      }
      
      if (index === prevIndex && dragRenderOffset > 0) {
        return { 
          translateX: `${dragRenderOffset - 100}%`, 
          opacity: Math.max(0, dragRenderOffset * 0.01) 
        };
      } else if (index === nextIndex && dragRenderOffset < 0) {
        return { 
          translateX: `${dragRenderOffset + 100}%`, 
          opacity: Math.max(0, Math.abs(dragRenderOffset) * 0.01) 
        };
      }
      
      return { translateX: dragRenderOffset > 0 ? '-100%' : '100%', opacity: 0 };
    }
    
    if (!isTransitioning) {
      if (index === currentPageIndex) {
        return { translateX: '0%', opacity: 1 };
      }
      return { translateX: '100%', opacity: 0 };
    }

    const { oldIndex, newIndex, direction } = transitionState;
    
    if (index === oldIndex) {
      return { 
        translateX: direction === 'left' ? '-100%' : '100%', 
        opacity: 0 
      };
    } else if (index === newIndex) {
      return { translateX: '0%', opacity: 1 };
    }
    
    return { translateX: '100%', opacity: 0 };
  }, [currentPageIndex, isDragRendering, dragRenderOffset, isTransitioning, transitionState, getAdjacentIndices]);

  // Determine which components to render (optimized)
  const shouldRender = useCallback((index: number) => {
    const { prevIndex, nextIndex } = getAdjacentIndices(currentPageIndex);

    if (isDragRendering) {
      return index === currentPageIndex || 
             (index === prevIndex && dragRenderOffset > 0) || 
             (index === nextIndex && dragRenderOffset < 0);
    }
    
    if (!isTransitioning) {
      return index === currentPageIndex;
    }
    
    const { oldIndex, newIndex } = transitionState;
    return index === oldIndex || index === newIndex;
  }, [currentPageIndex, isDragRendering, dragRenderOffset, isTransitioning, transitionState, getAdjacentIndices]);

  return (
    <DashBoard
      ref={dashBoardRef}
      className={colorTheme}
      onMouseDown={(e) => handlePointerStart(e.clientX)}
      onMouseMove={(e) => handlePointerMove(e.clientX)}
      onMouseUp={handlePointerEnd}
      onTouchStart={(e) => handlePointerStart(e.touches[0].clientX)}
      onTouchMove={(e) => handlePointerMove(e.touches[0].clientX)}
      onTouchEnd={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
    >
      <Wrapper>
        {components.map(({ component: Component }, index) => {
          if (!shouldRender(index)) return null;

          const { translateX, opacity } = getComponentTransform(index);

          return (
            <PageWrapper 
              key={`page-${index}`}
              translateX={translateX}
              opacity={opacity}
              isTransitioning={isTransitioning}
              isDragging={isDragRendering}
            >
              <Suspense fallback={
                <LoadingWrapper>
                  <Oval
                    visible={true}
                    height="80"
                    width="80"
                    color={theme.colors.theme[colorTheme].active}
                    ariaLabel="oval-loading"
                    wrapperStyle={{}}
                    wrapperClass=""
                    />
                </LoadingWrapper>
              }>
                <Component />
              </Suspense>
            </PageWrapper>
          );
        })}
      </Wrapper>
      <Pagination
        pages={components.length}
        colorActive={theme.colors.theme[colorTheme].active}
        colorInactive={theme.colors.medium}
        currentPage={currentPageIndex}
        dotSize={7.5}
      />
    </DashBoard>
  );
}

export default Dashboard;