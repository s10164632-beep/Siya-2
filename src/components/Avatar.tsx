import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';

interface AvatarProps {
  expression: string; // Action/Expression tags
  isSpeaking: boolean;
}

export default function Avatar({ expression, isSpeaking }: AvatarProps) {
  const [avatarSrc, setAvatarSrc] = useState<string | null>("/avatar.mp4");
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const mediaUrl = URL.createObjectURL(file);
      setAvatarSrc(mediaUrl);
    }
  };

  useEffect(() => {
    if (isSpeaking && videoRef.current) {
      videoRef.current.play().catch(e => {
        console.warn("Video play warning:", e.message || e);
      });
    } else if (!isSpeaking && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isSpeaking]);

  const getAnimationVariant = (expr: string) => {
    const e = expr.toLowerCase();
    if (e.includes('raise') && e.includes('both') && e.includes('hands')) return 'raise_both_hands';
    if (e.includes('raise') && e.includes('hand')) return 'raise_hands';
    if (e.includes('nod')) return 'nod';
    if (e.includes('tilt')) return 'tilt_head';
    if (e.includes('laugh')) return 'laugh';
    if (e.includes('surprise')) return 'surprise';
    return 'idle';
  };

  const actionVariants = {
    idle: { y: 0, rotate: 0, scale: 1 },
    raise_hands: { y: -20, scale: 1.05, transition: { type: 'spring', bounce: 0.5 } },
    raise_both_hands: { y: -30, scale: 1.1, transition: { type: 'spring', bounce: 0.6 } },
    nod: { y: [0, 15, 0, 15, 0], transition: { duration: 0.6 } },
    tilt_head: { rotate: 10, transition: { type: 'spring' } },
    laugh: { y: [0, -5, 0, -5, 0, -5, 0], transition: { duration: 0.5 } },
    surprise: { scale: 1.1, y: -10, transition: { type: 'spring', bounce: 0.7 } }
  };

  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden rounded-full">
      <motion.div
        className="w-full h-full relative bg-gray-900 flex items-center justify-center text-xs text-gray-500 text-center"
        variants={actionVariants}
        initial="idle"
        animate={getAnimationVariant(expression)}
      >
        {avatarSrc ? (
          <video 
            ref={videoRef}
            src={avatarSrc} 
            loop 
            muted 
            playsInline
            className="w-full h-full object-cover scale-[1.5] relative z-10" // Scale to focus on the character
            onError={() => {
              setAvatarSrc(null);
            }}
          />
        ) : (
          <div className="absolute z-10 flex flex-col items-center justify-center p-4">
            <span className="mb-2 text-gray-300">Please select your avatar video</span>
            <input 
              type="file" 
              accept="video/mp4, video/webm, video/ogg" 
              onChange={handleMediaUpload}
              className="text-xs text-gray-300 w-full max-w-[200px]"
            />
          </div>
        )}
      </motion.div>
    </div>
  );
}
