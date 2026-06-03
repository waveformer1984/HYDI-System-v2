'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface Star {
    x: number;
    y: number;
    size: number;
    speed: number;
    opacity: number;
    twinkleSpeed: number;
    twinklePhase: number;
}

interface StarfieldProps {
    starCount?: number;
    baseSpeed?: number;
    mouseInfluence?: number;
    backgroundColor?: string;
    starColor?: string;
}

const createStar = (width: number, height: number): Star => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: Math.random() * 2 + 0.5,
    speed: Math.random() * 0.5 + 0.1,
    opacity: Math.random() * 0.5 + 0.3,
    twinkleSpeed: Math.random() * 0.02 + 0.01,
    twinklePhase: Math.random() * Math.PI * 2,
});

const createStars = (count: number, width: number, height: number): Star[] => {
    return Array.from({ length: count }, () => createStar(width, height));
};

export default function Starfield({
    starCount = 150,
    baseSpeed = 0.3,
    mouseInfluence = 0.5,
    backgroundColor = '#0a0a1a',
    starColor = '#ffffff',
}: StarfieldProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const starsRef = useRef<Star[]>([]);
    const mouseRef = useRef({ x: 0, y: 0 });
    const targetMouseRef = useRef({ x: 0, y: 0 });
    const animationFrameRef = useRef<number>(0);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    const handleMouseMove = useCallback((event: MouseEvent) => {
        targetMouseRef.current = { x: event.clientX, y: event.clientY };
    }, []);

    useEffect(() => {
        const handleResize = () => {
            if (canvasRef.current) {
                const { clientWidth: width, clientHeight: height } = canvasRef.current.parentElement || document.body;
                setDimensions({ width, height });
                starsRef.current = createStars(starCount, width, height);
            }
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        window.addEventListener('mousemove', handleMouseMove);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [starCount, handleMouseMove]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const animate = () => {
            // Smooth mouse following
            mouseRef.current.x += (targetMouseRef.current.x - mouseRef.current.x) * 0.05;
            mouseRef.current.y += (targetMouseRef.current.y - mouseRef.current.y) * 0.05;

            // Clear canvas with background
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, dimensions.width, dimensions.height);

            // Calculate mouse delta for direction
            const mouseDeltaX = targetMouseRef.current.x - mouseRef.current.x;
            const mouseDeltaY = targetMouseRef.current.y - mouseRef.current.y;
            const mouseMagnitude = Math.sqrt(mouseDeltaX ** 2 + mouseDeltaY ** 2);

            // Draw stars
            starsRef.current.forEach((star, index) => {
                // Update twinkle
                star.twinklePhase += star.twinkleSpeed;

                // Apply mouse influence on movement
                const influenceX = mouseMagnitude > 0 ? (mouseDeltaX / mouseMagnitude) * mouseInfluence : 0;
                const influenceY = mouseMagnitude > 0 ? (mouseDeltaY / mouseMagnitude) * mouseInfluence : 0;

                // Move star (gentle drift + mouse influence)
                star.y += star.speed + influenceY * 0.1;
                star.x += influenceX * 0.1;

                // Wrap around edges
                if (star.y > dimensions.height) {
                    star.y = 0;
                    star.x = Math.random() * dimensions.width;
                }
                if (star.x > dimensions.width) star.x = 0;
                if (star.x < 0) star.x = dimensions.width;

                // Calculate opacity with twinkle
                const twinkleOpacity = star.opacity * (0.7 + 0.3 * Math.sin(star.twinklePhase));

                // Draw star
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx.fillStyle = starColor;
                ctx.globalAlpha = twinkleOpacity;
                ctx.fill();
                ctx.globalAlpha = 1;

                // Add glow effect for larger stars
                if (star.size > 1.2) {
                    ctx.beginPath();
                    ctx.arc(star.x, star.y, star.size * 2, 0, Math.PI * 2);
                    const gradient = ctx.createRadialGradient(
                        star.x, star.y, 0,
                        star.x, star.y, star.size * 2
                    );
                    gradient.addColorStop(0, `${starColor}${Math.floor(twinkleOpacity * 30).toString(16).padStart(2, '0')}`);
                    gradient.addColorStop(1, 'transparent');
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }
            });

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [dimensions, backgroundColor, starColor, baseSpeed, mouseInfluence]);

    return (
        <div className="starfield-container" style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
            <canvas
                ref={canvasRef}
                width={dimensions.width}
                height={dimensions.height}
                style={{ display: 'block' }}
            />
        </div>
    );
}
