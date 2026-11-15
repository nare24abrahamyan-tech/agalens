export interface Sample {
  id: string;
  name: string;
  description: string;
  code: string;
  stdin: string;
  /** for function-only snippets (no main) */
  entryCall?: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'max-subarray',
    name: 'Max Subarray (function only)',
    description: "Kadane's algorithm as a bare function: no main, no includes.",
    stdin: '',
    entryCall: 'maxSubarraySum({-2, 1, -3, 4, -1, 2, 1, -5, 4})',
    code: `int maxSubarraySum(vector<int> &arr) {
    // Code here
    int max_array = INT_MIN;
    int sum = 0;

    for (int num : arr) {
        if (sum < 0) {
            sum = 0;
        }

        sum += num;
        max_array = max(sum, max_array);
    }
    return max_array;
}
`,
  },
  {
    id: 'bubble-sort',
    name: 'Bubble Sort',
    description: 'Repeatedly swap adjacent out-of-order elements.',
    stdin: '',
    code: `#include <iostream>
using namespace std;

int main() {
    int arr[] = {64, 34, 25, 12, 22, 11, 90};
    int n = sizeof(arr) / sizeof(arr[0]);

    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }

    cout << "Sorted array: ";
    for (int i = 0; i < n; i++) {
        cout << arr[i] << " ";
    }
    cout << endl;
    return 0;
}
`,
  },
  {
    id: 'array-reversal',
    name: 'Array Reversal',
    description: 'Two pointers swap elements from both ends (reads stdin).',
    stdin: '6\n1 2 3 4 5 6\n',
    code: `#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;

    int a[100];
    for (int i = 0; i < n; i++) {
        cin >> a[i];
    }

    int left = 0, right = n - 1;
    while (left < right) {
        swap(a[left], a[right]);
        left++;
        right--;
    }

    cout << "Reversed:";
    for (int i = 0; i < n; i++) {
        cout << " " << a[i];
    }
    cout << endl;
    return 0;
}
`,
  },
  {
    id: 'two-sum',
    name: 'Two Sum',
    description: 'Find two indices whose values add up to the target (vector + stdin).',
    stdin: '6\n2 7 11 15 3 6\n9\n',
    code: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n, target;
    cin >> n;
    vector<int> nums(n);
    for (int i = 0; i < n; i++) {
        cin >> nums[i];
    }
    cin >> target;

    int ansI = -1, ansJ = -1;
    for (int i = 0; i < n && ansI == -1; i++) {
        for (int j = i + 1; j < n; j++) {
            if (nums[i] + nums[j] == target) {
                ansI = i;
                ansJ = j;
                break;
            }
        }
    }

    if (ansI == -1) {
        cout << "No solution" << endl;
    } else {
        cout << "Indices: " << ansI << " " << ansJ << endl;
    }
    return 0;
}
`,
  },
  {
    id: 'linear-search',
    name: 'Linear Search',
    description: 'Scan the array until the key is found (reads stdin).',
    stdin: '8\n5 3 9 1 7 4 8 2\n7\n',
    code: `#include <iostream>
using namespace std;

int main() {
    int n, key;
    cin >> n;
    int arr[50];
    for (int i = 0; i < n; i++) {
        cin >> arr[i];
    }
    cin >> key;

    int found = -1;
    for (int i = 0; i < n; i++) {
        if (arr[i] == key) {
            found = i;
            break;
        }
    }

    if (found >= 0) {
        cout << "Found " << key << " at index " << found << endl;
    } else {
        cout << key << " not found" << endl;
    }
    return 0;
}
`,
  },
  {
    id: 'binary-search',
    name: 'Binary Search',
    description: 'Halve the search range of a sorted array each step.',
    stdin: '',
    code: `#include <iostream>
using namespace std;

int binarySearch(int arr[], int n, int target) {
    int lo = 0, hi = n - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) {
            return mid;
        } else if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return -1;
}

int main() {
    int arr[] = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
    int n = sizeof(arr) / sizeof(arr[0]);
    int idx = binarySearch(arr, n, 23);
    cout << "Index of 23: " << idx << endl;
    return 0;
}
`,
  },
  {
    id: 'insertion-sort',
    name: 'Insertion Sort',
    description: 'Grow a sorted prefix by inserting one element at a time (vector).',
    stdin: '',
    code: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v = {9, 4, 7, 3, 8, 1, 5};

    for (int i = 1; i < (int)v.size(); i++) {
        int key = v[i];
        int j = i - 1;
        while (j >= 0 && v[j] > key) {
            v[j + 1] = v[j];
            j--;
        }
        v[j + 1] = key;
    }

    for (int x : v) {
        cout << x << " ";
    }
    cout << endl;
    return 0;
}
`,
  },
  {
    id: 'fibonacci-dp',
    name: 'Fibonacci (DP)',
    description: 'Bottom-up dynamic programming table.',
    stdin: '',
    code: `#include <iostream>
using namespace std;

int main() {
    int n = 10;
    long long dp[20];
    dp[0] = 0;
    dp[1] = 1;

    for (int i = 2; i <= n; i++) {
        dp[i] = dp[i - 1] + dp[i - 2];
    }

    cout << "fib(" << n << ") = " << dp[n] << endl;
    return 0;
}
`,
  },
  {
    id: 'matrix-2d',
    name: '2D Grid Sum',
    description: 'Fill and sum a 2D array, row by row.',
    stdin: '',
    code: `#include <iostream>
using namespace std;

int main() {
    int grid[3][4];
    int total = 0;

    for (int r = 0; r < 3; r++) {
        for (int c = 0; c < 4; c++) {
            grid[r][c] = (r + 1) * (c + 1);
            total += grid[r][c];
        }
    }

    cout << "Sum = " << total << endl;
    return 0;
}
`,
  },
  {
    id: 'factorial',
    name: 'Recursive Factorial',
    description: 'Watch the call stack grow and unwind.',
    stdin: '',
    code: `#include <iostream>
using namespace std;

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    int result = factorial(5);
    cout << "5! = " << result << endl;
    return 0;
}
`,
  },
];

export const DEFAULT_SAMPLE = SAMPLES.find((s) => s.id === 'bubble-sort') ?? SAMPLES[0];
