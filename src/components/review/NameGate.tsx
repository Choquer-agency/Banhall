"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface NameGateProps {
  projectTitle: string;
  clientName: string;
  onEnter: (name: string) => void;
}

export function NameGate({ projectTitle, clientName, onEnter }: NameGateProps) {
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      onEnter(name.trim());
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-navy">
            Banhall
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Report Review
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            {projectTitle}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {clientName} has shared this report for your review.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            <Input
              id="name"
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name to continue"
              required
              autoFocus
            />
            <Button type="submit" disabled={!name.trim()}>
              View Report
            </Button>
          </form>

          <p className="mt-3 text-center text-xs text-gray-400">
            Your name will be shown on any comments you leave.
          </p>
        </div>
      </div>
    </div>
  );
}
