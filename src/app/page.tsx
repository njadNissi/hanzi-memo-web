"use client";

enum TriggerMode {
  Debounce = "DEBOUNCE",
  Button = "BUTTON",
}

const envTriggerMode = process.env.NEXT_PUBLIC_TRIGGER_MODE as TriggerMode;
const TRIGGER_MODE = envTriggerMode ?? TriggerMode.Debounce;
const CHUNK_SIZE = parseInt(process.env.NEXT_PUBLIC_CHUNK_SIZE ?? "20");

import {useEffect, useState} from "react";
import {useDebounce} from "use-debounce";
import {Header} from "@/components/Header";
import {ZHChar} from "@/components/ZHChar";
import {Collection, getCollections, getPinyins, Segment} from "./api/backend";
import ModalLayout from "@/components/Modal";

const LS_BL_COLL = "collection_blacklist";
const LS_LX_BLACKLIST = "lexeme_blacklist";
const LS_LX_WHITELIST = "lexeme_whitelist";
const LS_PREVIOUS_TEXT = "previous_text";

interface ZHCharView {
  id: string
  zh: string
  pinyin: string
  visible: boolean
}


// TODO: Apply cosmetics
export default function Home() {
  const visibilityMode = [
    {key: "show_all", label: "Show All"},
    {key: "smart", label: "Smart"},
    {key: "hide_all", label: "Hide All"},
  ];

  const [firstRender, setFirstRender] = useState(true);
  let _userBlackListColl: string[] = [];
  let _userBlacklist: string[] = [];
  let _userWhitelist: string[] = [];
  let userPreviousText: string = "";

  useEffect(() => {
    if (typeof window !== "undefined" && firstRender) {
      _userBlacklist = JSON.parse(localStorage.getItem(LS_LX_BLACKLIST) || "[]");
      _userWhitelist = JSON.parse(localStorage.getItem(LS_LX_WHITELIST) || "[]")
      _userBlackListColl = JSON.parse(localStorage.getItem(LS_BL_COLL) || "[]");
      userPreviousText = localStorage.getItem(LS_PREVIOUS_TEXT) || "";

      setInputText(userPreviousText)
      setWhitelist(_userWhitelist)
      setBlacklist(_userBlacklist)
      setBlacklistColl(_userBlackListColl)
      setFirstRender(false)
    }
  }, [])

  const [mode, setMode] = useState(visibilityMode[1].key);
  const [inputText, setInputText] = useState(userPreviousText);
  const [debouncedInputText] = useDebounce(inputText, 1000);
  const [job, setJob] = useState<Segment[][]>([]);
  const [zhText, setZhText] = useState<ZHCharView[]>([]);
  const [visibleStates, setVisibleStates] = useState(
      zhText.map((x) => x.visible)
  );

  const [blacklist, setBlacklist] = useState(_userBlacklist);
  const [whitelist, setWhitelist] = useState(_userWhitelist);
  const [modalVisible, setModalVisible] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [blacklistColl, setBlacklistColl] = useState(_userBlackListColl);
  const [isLoading, setIsLoading] = useState(false);


  useEffect(() => {
    localStorage.setItem(LS_LX_BLACKLIST, JSON.stringify(blacklist));
    localStorage.setItem(LS_LX_WHITELIST, JSON.stringify(whitelist));
  }, [whitelist, blacklist])


  function isVisible(mode: string, item: ZHCharView): boolean {
    if (mode == "show_all") return true;
    if (mode == "hide_all") return false;

    if (blacklist.includes(item.id)) return false;
    if (whitelist.includes(item.id)) return true;

    return item.visible;
  }

  useEffect(() => {
    getCollections()
        .then((data) => {
          setCollections(data.data);
        })
        .catch((err) => console.log("Err", err));
  }, []);

  function fireChanges() {
    localStorage.setItem(LS_PREVIOUS_TEXT, debouncedInputText)

    setIsLoading(true);
    const collectionBL = JSON.parse(localStorage.getItem(LS_BL_COLL) || "[]")
    const chunks = chunkify(inputText, CHUNK_SIZE).map((x, i) => ({text: x, index: i}));
    setJob(new Array(chunks.length).fill([]))
    chunks.forEach(chunk => {
      getPinyins(chunk.text, blacklist, whitelist, collectionBL)
          .then((res) => {
            setJob((prev) => {
              return [...prev.slice(0, chunk.index), res.data, ...prev.slice(chunk.index + 1)]
            })
          })
    })

  }

  useEffect(() => {
    const flatSegment = job.reduce((a, b) => [...a, ...b], [])
    setZhText(flatSegment.map(s => {
      let pinyin_id = `--no-id-${s.segment}--`;
      let pinyin_text = s.segment;

      if (s.pinyin.length > 0) {
        pinyin_id = s.pinyin[0].id;
        pinyin_text = s.pinyin[0].pinyin ?? "";
      }

      return {
        id: pinyin_id,
        pinyin: pinyin_text,
        zh: s.segment,
        visible: s.strict_visible,
      }
    }))
    setIsLoading(false);
  }, [job])

  function chunkify(text: string, size: number): string[] {
    const re = new RegExp(`.{1,${size}}`, "g")
    console.log(re)
    return text.match(re) as string[]
  }

  useEffect(() => {
    if (TRIGGER_MODE == TriggerMode.Button) return;

    // FIX: don't fire on init
    if (debouncedInputText.trim().length != 0) {
      fireChanges();
    }
  }, [debouncedInputText]);

  useEffect(() => {
    setVisibleStates(
        zhText.map((x, i) => {
          return isVisible(mode, x);
        })
    );
  }, [mode, zhText]);

  function getLists(original: string[]): string[] {
    const makeSet = (a: string[], b: string) => {
      if (!a.includes(b)) a.push(b);
      return a;
    };

    const allId = zhText.map(x => x.id)
    const unrelated = original.filter(x => !allId.includes(x))
    const listFromRequest = zhText
        .filter(x => original.includes(x.id))
        .map(x => x.id);

    return [
      ...unrelated,
      ...listFromRequest
    ].reduce(makeSet, [])
  }


  // =================== Handler
  function updateCheckbox(item: ZHCharView, checked: boolean) {
    const changes = zhText.map((x, i) => x.id == item.id);
    setVisibleStates(
        visibleStates.map((ori_state, i) => {
          if (changes[i]) {
            return !checked;
          }
          return ori_state;
        })
    );

    // FIXME: this didnt differentiate between words that blacklisted from the collection
    // TODO: get exclusive blacklist/white list from backend
    let newBlacklist = getLists(blacklist);
    let newWhitelist = getLists(whitelist);

    if (checked) {
      newBlacklist.push(item.id)
      newWhitelist = newWhitelist.filter(x => x !== item.id)
    } else {
      newBlacklist = newBlacklist.filter(x => x !== item.id)
      newWhitelist.push(item.id)
    }

    setBlacklist(newBlacklist)
    setWhitelist(newWhitelist)
  }


  function onCollectionModalOK(selectedCollection: string[]) {
    localStorage.setItem(LS_BL_COLL, JSON.stringify(selectedCollection))
    setModalVisible(false)
    fireChanges()
  }

  return (
      <main className="flex min-h-screen flex-col items-center justify-between l:p-24">
        <ModalLayout
            isVisible={modalVisible}
            collections={collections}
            blackListColl={blacklistColl}
            onOK={onCollectionModalOK}
            onCancel={() => setModalVisible(false)}
        />
        <Header onPresetChange={(t) => setInputText(t)}/>
        {/* ================ Body */}
        <section
            className="h-3/5 max-h-[70vw] min-h-[10rem] w-full flex justify-center flex-grow bg-gray-800 p-4 overflow-y-scroll items-start">
          <div className={`flex jusity-center items-center ${isLoading ? "" : "hidden"}`}>Loading...</div>
          <div className={`flex flex-wrap items-start ${!isLoading ? "visible" : "hidden"}`}>
            {zhText.map((item, i) => (
                <div key={i}>
                  <input
                      type="checkbox"
                      className="scale-75"
                      id={`toggle-${item.id}-i`}
                      alt="disable"
                      hidden
                      disabled={mode != "smart"}
                      name={item.zh}
                      checked={!visibleStates[i]}
                      onChange={(e) => updateCheckbox(item, e.target.checked)}
                  />
                  <label
                      htmlFor={`toggle-${item.id}-i`}
                      title={`click to ${
                          visibleStates[i] ? "hide" : "show"
                      } this character`}
                      className="hover:cursor-pointer"
                  >
                    <ZHChar
                        zh={item.zh}
                        pinyin={item.pinyin}
                        is_visible={visibleStates[i]}
                    />
                  </label>
                </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col flex-grow h-2/5 min-h-[8rem] w-full relative">
          <div className="flex text-white text-lg bg-blue-900 items-center">

            <div
                className={`flex gap-2 p-2 bg-white text-black hover:bg-gray-400 hover:text-white md:hover:cursor-pointer font-bold`}
                onClick={() => setModalVisible(!modalVisible)}
            >
              <span>Blacklist</span>
            </div>
            <div className="flex flex-row-reverse flex-grow">
              {visibilityMode.map((x, i) => (
                  <label
                      className={`flex gap-2 h-full p-2 hover:bg-gray-400 hover:cursor-pointer ${
                          mode == x.key ? "bg-gray-200 text-black font-bold" : ""
                      }`}
                      key={i}
                  >
                    <input
                        type="radio"
                        name="visibility-toggle"
                        onChange={() => setMode(x.key)}
                        hidden={true}
                    />
                    <span>{x.label}</span>
                  </label>
              ))}
            </div>
          </div>
          <div className="flex-grow">
            <textarea
                className="w-full h-full bg-gray-900 p-4"
                placeholder="Write something here"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}/>
          </div>
          {TRIGGER_MODE == TriggerMode.Button &&
              <button
                  className="p-2 bg-white text-black font-bold absolute bottom-5 right-5 hover:bg-gray-400 hover:text-white"
                  onClick={() => fireChanges()}>
                  Analyze
              </button>
          }
        </section>
      </main>
  );
}