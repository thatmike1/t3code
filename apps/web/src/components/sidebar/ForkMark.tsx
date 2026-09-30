import { cn } from "../../lib/utils";

// mike's hand-drawn "fork" scribble (284x116, white strokes on transparent), used as a
// mask so it takes the surrounding text colour in both themes.
const FORK_MARK_MASK =
  "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAARwAAAB0CAYAAABXJI1jAAAEs0lEQVR42u3d27abMAxF0dLB//8yfSltmuYGwbYkz/XYjhBZlre3DOH8+AEEY9u2TRYAEB25/Yqf0g+A4AAgOABwlrVnr7gsyyLl+IRlWZZt2zY1g1Ni8+zfgCM1BHk9NCBFBKKTP6dh5uWTQBQRCE7enH7zeYfGAOorp50LaoXDAYCXYhPizuEZ1bNzQa3kyuW388DhAOjGUMHZH+4yDcAcLRGHgxTYnDgchQSAwwFQrx37J5AI18AcRS8LY/J3Re45HIBD6eZuwgiOsxygPhwOgDkFh8sBCA6A5ES5w0RwkAou+JzYcDgAugo1wQEwjdgQHAAEB5iRGc6mCA5StggVF+cMB+IEByA6b53XVedABAcgOhwOgDgCGC4oD2NBzRkbhwNoqwgOgPkgOACXQ3AAcDgAuJzxSArUnXFyOACnQ3AAzOdGCQ7A5egxAXVXZ8x7zBwOwOlQXUDt1Rhzs1iJDiw+4yY4sPCMPUR8znCAxEx9nsPh/M3DI2SmTu1Fm9OI9dU8JovqdQ4ITy3BseEHiEc/HTdH3pBXz9lEjK9rDAQndp6qzk+PcWVyqFHra7X4r3tJ9JHr7Id9IV9Qjea10iPO3vX1yfelFpxXonIk0aMWfkbRuc35TGKZcXO4vYPVMvYe39HdzlW+69N7PGe+61GMs9ylqVBrrdbN0eutkROU0cp+Y9Mj7qLDd6/BbrFK23s7hivW1tm6WAlMO3U/OoZoLda7WKqfQ1Ud2/2Yzries3lZoyzWyBP7bELexXzmcw6TubrRApR60h71kJluLbY6jxp9ZnBlDFHm84o4PJjZlrVXAWS8E9Mq5nfX5XK4Ghx0BVl3ipl+H/Ps+ke/N7vD2T/H3SQUmszWdLbfx1QTnG9iJzZJhSZrPxw11hEu5+xzOpnyVWGDzMj67cRm73mjj8N5Tps5l88Cjiabw+HAHl+7ssO5ytEhkNBkmMhsRRZdcDKIToXWn9AkXNjuoM0nOMQmBuu7SdDr1uf2nKji+YYzm6CCM8PDT4pvPof+bL7VwkDBkfxcTkQ2Pmur5CrgxMzyLpEq7zWJXAsRcvxJDM5uBjkcOwAqOhsoAoUYfCzZHc6RJ4cJ0xj85U38IbPbPXK25RyM4ABdxAYEByeciJaA2BAcRVkmX7KAtIJjR4aNBFoqNNlcZAEEp+DC5hq5IoIDAAQHwDSCowVAz5pSbxwOkixiWQDBAV44GW6G4CAxmRbw8ptPfrDJwREcgNshOO0KQtox2u2AwwEuFZ69jSI+BGeI1a40JucRn4sOx0NwQKSHOh7OZwzrbAuIKyCk907x2f+hgOBY+PHbqZlakNs83o9ZjXI4xE6+hrgfIkRwuJsOYqP9+j//Rz9ToR4Ijl0bAxbmu2u0EOme39l6XUzpcLKKDqHM6YqumHctFaYRZpmoJ2JTWlwxxI81u+Ds8RPOGEz94F+GHXx/QM0uBy1VMdGJtKgjxpTZ5cgjwQnXI0dZ5BYICA7hmdLVED4QnM7C03Lh+S1Pv5YZBCeF8NwLwxUC4YwGU66pkV+e/azim52T0KgzDgdEA2iIF3ABIDgACA6QEneqCA4AggPUwuE+wQFAcPTWAADY2ArwC1FkzkkFrm0fAAAAAElFTkSuQmCC)";

/** The fork's own mark beside the wordmark, where upstream shows its stage pill. */
export function ForkMark({ className }: { className?: string }) {
  return (
    <span
      aria-label="fork"
      role="img"
      className={cn("inline-block h-5 shrink-0 bg-current", className)}
      style={{
        aspectRatio: "284 / 116",
        maskImage: FORK_MARK_MASK,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}
