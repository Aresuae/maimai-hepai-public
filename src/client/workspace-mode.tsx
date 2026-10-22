"use client";
import { createContext, useContext } from "react";
export const RemoteWorkspace = createContext(false);
export const useRemoteWorkspace = () => useContext(RemoteWorkspace);
